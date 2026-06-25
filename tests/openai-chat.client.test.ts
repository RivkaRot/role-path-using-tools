import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recommendationsResponseSchema,
  type RecommendationsResponse,
} from '../src/schemas/assessment.schemas.js';
import { recommendationsFixture } from './fixtures.js';
import {
  OpenAIChatClient,
  type ToolResponseValidator,
} from '../src/clients/openai-chat.client.js';
import { getToolDefinitions, getToolHandler } from '../src/tools/tool-registry.js';

vi.mock('../src/tools/tool-registry.js', () => ({
  getToolDefinitions: vi.fn(),
  getToolHandler: vi.fn(),
}));

const SEARCH_TOOL_NAME = 'search_internet';
const CALENDAR_TOOL_NAME = 'create_calendar_event';
const mockedGetToolDefinitions = vi.mocked(getToolDefinitions);
const mockedGetToolHandler = vi.mocked(getToolHandler);

function createMockClient() {
  return {
    chat: {
      completions: {
        parse: vi.fn(),
        create: vi.fn(),
      },
    },
  } as const;
}

const requireVerifiedCalendarEventsValidator: ToolResponseValidator = (parsed, audit) => {
  const recommendations = parsed as RecommendationsResponse;
  const successfulCalendarCalls = audit.records.filter(
    (record) => record.toolName === CALENDAR_TOOL_NAME && record.succeeded,
  );

  if (successfulCalendarCalls.length !== recommendations.calendarEvents.length) {
    return {
      ok: false,
      errorMessage: 'Missing required calendar tool calls',
      retryMessage: 'Call create_calendar_event exactly once per topic before returning JSON.',
    };
  }

  const unmatchedCalls = [...successfulCalendarCalls];
  for (const calendarEvent of recommendations.calendarEvents) {
    const matchedCallIndex = unmatchedCalls.findIndex((record) => {
      const args = record.args as {
        title?: string;
        startDateTime?: string;
        endDateTime?: string;
      };
      const result = record.result as {
        id?: string;
        htmlLink?: string | null;
      };

      return (
        args.title === calendarEvent.title
        && args.startDateTime === calendarEvent.startDateTime
        && args.endDateTime === calendarEvent.endDateTime
        && result.id === calendarEvent.eventId
        && (result.htmlLink ?? null) === calendarEvent.calendarLink
      );
    });

    if (matchedCallIndex === -1) {
      return {
        ok: false,
        errorMessage: 'Calendar event fields did not match tool results',
        retryMessage: 'Use only create_calendar_event results for eventId and calendarLink.',
      };
    }

    unmatchedCalls.splice(matchedCallIndex, 1);
  }

  return { ok: true };
};

beforeEach(() => {
  mockedGetToolDefinitions.mockReset();
  mockedGetToolHandler.mockReset();
  mockedGetToolDefinitions.mockReturnValue([
    {
      type: 'function',
      function: {
        name: SEARCH_TOOL_NAME,
        description: 'Search the internet for up-to-date information',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
            },
          },
          required: ['query'],
        },
      },
    },
  ]);
});

describe('OpenAIChatClient tool loop', () => {
  it('returns structured recommendations when the first response is final JSON', async () => {
    const mockClient = createMockClient();
    mockClient.chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(recommendationsFixture) } }],
    });
    const client = new OpenAIChatClient('test-key', 'test-model', mockClient as never);
    await expect(
      client.createStructuredCompletionWithTools(
        'recommendation prompt',
        'recommendations_response',
        recommendationsResponseSchema,
      ),
    ).resolves.toEqual(recommendationsFixture);

    expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(mockClient.chat.completions.create.mock.calls[0]?.[0].tools).toHaveLength(1);
  });

  it('executes a search_web tool call and returns the final structured result', async () => {
    const mockClient = createMockClient();
    mockClient.chat.completions.create
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: SEARCH_TOOL_NAME,
                    arguments: JSON.stringify({ query: 'react docs', limit: 3 }),
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(recommendationsFixture) } }],
      });
    const searchHandler = vi.fn().mockResolvedValue([
      {
        title: 'React Docs',
        url: 'https://react.dev',
        snippet: 'Official documentation',
      },
    ]);
    mockedGetToolHandler.mockReturnValue(searchHandler);

    const client = new OpenAIChatClient('test-key', 'test-model', mockClient as never);
    await expect(
      client.createStructuredCompletionWithTools(
        'recommendation prompt',
        'recommendations_response',
        recommendationsResponseSchema,
      ),
    ).resolves.toEqual(recommendationsFixture);

    expect(searchHandler).toHaveBeenCalledWith({ query: 'react docs', limit: 3 });
    const secondCallMessages = mockClient.chat.completions.create.mock.calls[1]?.[0].messages;
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'tool', tool_call_id: 'call_1' }),
      ]),
    );
  });

  it('supports calendar tool calls before returning recommendation JSON with calendar events', async () => {
    mockedGetToolDefinitions.mockReturnValue([createCalendarToolDefinition()]);

    const mockClient = createMockClient();
    mockClient.chat.completions.create
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: createCalendarToolCalls(recommendationsFixture),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(recommendationsFixture) } }],
      });
    mockedGetToolHandler.mockReturnValue(createCalendarHandlerFor(recommendationsFixture) as never);

    const client = new OpenAIChatClient('test-key', 'test-model', mockClient as never);
    await expect(
      client.createStructuredCompletionWithTools(
        'recommendation prompt',
        'recommendations_response',
        recommendationsResponseSchema,
        { validateParsedResponse: requireVerifiedCalendarEventsValidator },
      ),
    ).resolves.toEqual(recommendationsFixture);

    expect(mockedGetToolHandler.mock.results[0]?.value).toHaveBeenCalledTimes(3);
    expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(2);
    const secondCallMessages = mockClient.chat.completions.create.mock.calls[1]?.[0].messages;
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'tool', tool_call_id: 'call_1' }),
        expect.objectContaining({ role: 'tool', tool_call_id: 'call_2' }),
        expect.objectContaining({ role: 'tool', tool_call_id: 'call_3' }),
      ]),
    );
  });

  it('handles multiple tool rounds and stops when a final answer arrives', async () => {
    const mockClient = createMockClient();
    mockClient.chat.completions.create
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: SEARCH_TOOL_NAME,
                    arguments: JSON.stringify({ query: 'node testing' }),
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_2',
                  type: 'function',
                  function: {
                    name: SEARCH_TOOL_NAME,
                    arguments: JSON.stringify({ query: 'vitest guide', limit: 2 }),
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(recommendationsFixture) } }],
      });
    const searchHandler = vi
      .fn()
      .mockResolvedValueOnce([{ title: 'Node', url: 'https://nodejs.org' }])
      .mockResolvedValueOnce([{ title: 'Vitest', url: 'https://vitest.dev' }]);
    mockedGetToolHandler.mockReturnValue(searchHandler);

    const client = new OpenAIChatClient('test-key', 'test-model', mockClient as never);
    await expect(
      client.createStructuredCompletionWithTools(
        'recommendation prompt',
        'recommendations_response',
        recommendationsResponseSchema,
      ),
    ).resolves.toEqual(recommendationsFixture);

    expect(searchHandler).toHaveBeenCalledTimes(2);
    expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(3);
  });

  it('forces a final no-tools call after five tool rounds', async () => {
    const mockClient = createMockClient();
    for (let index = 0; index < 5; index += 1) {
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: `call_${index + 1}`,
                  type: 'function',
                  function: {
                    name: SEARCH_TOOL_NAME,
                    arguments: JSON.stringify({ query: `query ${index + 1}` }),
                  },
                },
              ],
            },
          },
        ],
      });
    }
    mockClient.chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(recommendationsFixture) } }],
    });
    const searchHandler = vi.fn().mockResolvedValue([]);
    mockedGetToolHandler.mockReturnValue(searchHandler);

    const client = new OpenAIChatClient('test-key', 'test-model', mockClient as never);
    await expect(
      client.createStructuredCompletionWithTools(
        'recommendation prompt',
        'recommendations_response',
        recommendationsResponseSchema,
      ),
    ).resolves.toEqual(recommendationsFixture);

    expect(searchHandler).toHaveBeenCalledTimes(5);
    expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(6);
    const finalCall = mockClient.chat.completions.create.mock.calls[5]?.[0];
    expect(finalCall.tools).toBeUndefined();
    expect(finalCall.tool_choice).toBe('none');
  });

  it('throws a clear error when the final answer is invalid JSON', async () => {
    const mockClient = createMockClient();
    mockClient.chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: 'not json' } }],
    });
    const client = new OpenAIChatClient('test-key', 'test-model', mockClient as never);
    await expect(
      client.createStructuredCompletionWithTools(
        'recommendation prompt',
        'recommendations_response',
        recommendationsResponseSchema,
      ),
    ).rejects.toThrow('OpenAI returned invalid JSON for recommendations_response');
  });

  it('sends a tool error payload back to the model when tool arguments are malformed', async () => {
    const mockClient = createMockClient();
    mockClient.chat.completions.create
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: SEARCH_TOOL_NAME,
                    arguments: '{"query"',
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(recommendationsFixture) } }],
      });
    const searchHandler = vi.fn();
    mockedGetToolHandler.mockReturnValue(searchHandler);

    const client = new OpenAIChatClient('test-key', 'test-model', mockClient as never);
    await expect(
      client.createStructuredCompletionWithTools(
        'recommendation prompt',
        'recommendations_response',
        recommendationsResponseSchema,
      ),
    ).resolves.toEqual(recommendationsFixture);

    expect(searchHandler).not.toHaveBeenCalled();
    const secondCallMessages = mockClient.chat.completions.create.mock.calls[1]?.[0].messages;
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          tool_call_id: 'call_1',
          content: expect.stringContaining('"ok":false'),
        }),
      ]),
    );
  });

  it('sends a tool error payload back to the model when a tool handler throws', async () => {
    const mockClient = createMockClient();
    mockClient.chat.completions.create
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: SEARCH_TOOL_NAME,
                    arguments: JSON.stringify({ query: 'react docs' }),
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(recommendationsFixture) } }],
      });
    mockedGetToolHandler.mockReturnValue(
      vi.fn().mockRejectedValue(new Error('search backend unavailable')),
    );

    const client = new OpenAIChatClient('test-key', 'test-model', mockClient as never);
    await expect(
      client.createStructuredCompletionWithTools(
        'recommendation prompt',
        'recommendations_response',
        recommendationsResponseSchema,
      ),
    ).resolves.toEqual(recommendationsFixture);

    const secondCallMessages = mockClient.chat.completions.create.mock.calls[1]?.[0].messages;
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          tool_call_id: 'call_1',
          content: expect.stringContaining('search backend unavailable'),
        }),
      ]),
    );
  });

  it('retries when recommendations arrive without any calendar tool calls and then succeeds', async () => {
    mockedGetToolDefinitions.mockReturnValue([createCalendarToolDefinition()]);

    const mockClient = createMockClient();
    mockClient.chat.completions.create
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(recommendationsFixture) } }],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: createCalendarToolCalls(recommendationsFixture),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(recommendationsFixture) } }],
      });
    mockedGetToolHandler.mockReturnValue(createCalendarHandlerFor(recommendationsFixture) as never);

    const client = new OpenAIChatClient('test-key', 'test-model', mockClient as never);
    await expect(
      client.createStructuredCompletionWithTools(
        'recommendation prompt',
        'recommendations_response',
        recommendationsResponseSchema,
        { validateParsedResponse: requireVerifiedCalendarEventsValidator },
      ),
    ).resolves.toEqual(recommendationsFixture);

    const secondCallMessages = mockClient.chat.completions.create.mock.calls[1]?.[0].messages;
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('Call create_calendar_event exactly once per topic'),
        }),
      ]),
    );
  });

  it('fails after retries when recommendations keep skipping calendar tool calls', async () => {
    const mockClient = createMockClient();
    mockClient.chat.completions.create
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(recommendationsFixture) } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(recommendationsFixture) } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(recommendationsFixture) } }],
      });

    const client = new OpenAIChatClient('test-key', 'test-model', mockClient as never);
    await expect(
      client.createStructuredCompletionWithTools(
        'recommendation prompt',
        'recommendations_response',
        recommendationsResponseSchema,
        { validateParsedResponse: requireVerifiedCalendarEventsValidator },
      ),
    ).rejects.toThrow('Missing required calendar tool calls');
  });

  it('rejects recommendations when only two calendar tool calls were made', async () => {
    mockedGetToolDefinitions.mockReturnValue([createCalendarToolDefinition()]);

    const partialFixture: RecommendationsResponse = {
      ...recommendationsFixture,
      calendarEvents: recommendationsFixture.calendarEvents.slice(0, 2),
    };
    const mockClient = createMockClient();
    mockClient.chat.completions.create
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: createCalendarToolCalls(partialFixture),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(recommendationsFixture) } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(recommendationsFixture) } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(recommendationsFixture) } }],
      });
    mockedGetToolHandler.mockReturnValue(createCalendarHandlerFor(partialFixture) as never);

    const client = new OpenAIChatClient('test-key', 'test-model', mockClient as never);
    await expect(
      client.createStructuredCompletionWithTools(
        'recommendation prompt',
        'recommendations_response',
        recommendationsResponseSchema,
        { validateParsedResponse: requireVerifiedCalendarEventsValidator },
      ),
    ).rejects.toThrow('Missing required calendar tool calls');
  });

  it('rejects recommendations when tool-backed event fields do not match the tool results', async () => {
    mockedGetToolDefinitions.mockReturnValue([createCalendarToolDefinition()]);

    const mismatchedFixture: RecommendationsResponse = {
      ...recommendationsFixture,
      calendarEvents: recommendationsFixture.calendarEvents.map((event, index) =>
        index === 0 ? { ...event, eventId: 'invented-event-id' } : event,
      ),
    };
    const mockClient = createMockClient();
    mockClient.chat.completions.create
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: createCalendarToolCalls(recommendationsFixture),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(mismatchedFixture) } }],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: createCalendarToolCalls(recommendationsFixture),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(mismatchedFixture) } }],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: createCalendarToolCalls(recommendationsFixture),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(mismatchedFixture) } }],
      });
    mockedGetToolHandler.mockReturnValue(
      createCalendarHandlerFor({
        ...recommendationsFixture,
        calendarEvents: [
          ...recommendationsFixture.calendarEvents,
          ...recommendationsFixture.calendarEvents,
          ...recommendationsFixture.calendarEvents,
        ],
      }) as never,
    );

    const client = new OpenAIChatClient('test-key', 'test-model', mockClient as never);
    await expect(
      client.createStructuredCompletionWithTools(
        'recommendation prompt',
        'recommendations_response',
        recommendationsResponseSchema,
        { validateParsedResponse: requireVerifiedCalendarEventsValidator },
      ),
    ).rejects.toThrow('Calendar event fields did not match tool results');
  });

  it('accepts fallback draft links when the final JSON matches the actual tool responses', async () => {
    mockedGetToolDefinitions.mockReturnValue([createCalendarToolDefinition()]);

    const fallbackFixture: RecommendationsResponse = {
      ...recommendationsFixture,
      calendarEvents: recommendationsFixture.calendarEvents.map((event, index) => ({
        ...event,
        eventId: `draft-event-${index + 1}`,
        calendarLink: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=topic-${index + 1}`,
      })),
    };
    const mockClient = createMockClient();
    mockClient.chat.completions.create
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: createCalendarToolCalls(fallbackFixture),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(fallbackFixture) } }],
      });
    mockedGetToolHandler.mockReturnValue(createCalendarHandlerFor(fallbackFixture) as never);

    const client = new OpenAIChatClient('test-key', 'test-model', mockClient as never);
    await expect(
      client.createStructuredCompletionWithTools(
        'recommendation prompt',
        'recommendations_response',
        recommendationsResponseSchema,
        { validateParsedResponse: requireVerifiedCalendarEventsValidator },
      ),
    ).resolves.toEqual(fallbackFixture);
  });
});

function createCalendarToolDefinition() {
  return {
    type: 'function' as const,
    function: {
      name: CALENDAR_TOOL_NAME,
      description: 'Create a calendar deadline event',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          startDateTime: { type: 'string' },
          endDateTime: { type: 'string' },
        },
        required: ['title', 'startDateTime', 'endDateTime'],
      },
    },
  };
}

function createCalendarToolCalls(fixture: RecommendationsResponse) {
  return fixture.calendarEvents.map((calendarEvent, index) => ({
    id: `call_${index + 1}`,
    type: 'function' as const,
    function: {
      name: CALENDAR_TOOL_NAME,
      arguments: JSON.stringify({
        title: calendarEvent.title,
        startDateTime: calendarEvent.startDateTime,
        endDateTime: calendarEvent.endDateTime,
      }),
    },
  }));
}

function createCalendarHandlerFor(fixture: RecommendationsResponse) {
  return fixture.calendarEvents.reduce(
    (handler, calendarEvent) =>
      handler.mockResolvedValueOnce({
        id: calendarEvent.eventId,
        htmlLink: calendarEvent.calendarLink,
      }),
    vi.fn(),
  );
}
