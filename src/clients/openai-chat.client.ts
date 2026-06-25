import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { ZodType } from 'zod';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions/completions';
import { getToolDefinitions, getToolHandler } from '../tools/tool-registry.js';

const SYSTEM_PROMPT =
  'You create programming skill assessments and concise learning recommendations. When the prompt requests Hebrew output, every user-visible response field must be in Hebrew unless the prompt explicitly allows a non-Hebrew field such as a URL.';

const MAX_TOOL_ROUNDS = 1;
const MAX_VALIDATION_RETRIES = 3;

const DEFAULT_FINAL_RESPONSE_INSTRUCTIONS = [
  'All resource URLs must be valid HTTPS URLs.',
  'Every calendar event must start exactly at 18:00 in Asia/Jerusalem.',
  'If calendar events already exist from tool results, reuse their eventId and calendarLink values. Do not invent new calendar events.',
];

type CompletionOptions = {
  systemPromptAppendix?: string;
  validateParsedResponse?: ToolResponseValidator;
  finalResponseInstructions?: string[];
};

export type ToolExecutionRecord = {
  toolName: string;
  args: unknown;
  succeeded: boolean;
  result?: unknown;
};

export type ToolExecutionAudit = {
  records: ToolExecutionRecord[];
};

export type ToolResponseValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      errorMessage: string;
      retryMessage?: string;
    };

export type ToolResponseValidator = (
  parsed: unknown,
  audit: ToolExecutionAudit,
) => ToolResponseValidationResult;

type ToolPlanningContext = {
  messages: ChatCompletionMessageParam[];
  audit: ToolExecutionAudit;
  executedToolKeys: Set<string>;
};

export interface ChatCompletionClient {
  createStructuredCompletion<T>(
    prompt: string,
    schemaName: string,
    schema: ZodType<T>,
    options?: CompletionOptions,
  ): Promise<T>;

  createStructuredCompletionWithTools<T>(
    prompt: string,
    schemaName: string,
    schema: ZodType<T>,
    options?: CompletionOptions,
  ): Promise<T>;
}

export class OpenAIChatClient implements ChatCompletionClient {
  private readonly client: Pick<OpenAI, 'chat'>;

  public constructor(
    apiKey: string,
    private readonly model: string,
    client?: Pick<OpenAI, 'chat'>,
  ) {
    this.client = client ?? new OpenAI({ apiKey });
  }

  public async createStructuredCompletion<T>(
    prompt: string,
    schemaName: string,
    schema: ZodType<T>,
    options?: CompletionOptions,
  ): Promise<T> {
    const completion = await this.client.chat.completions.parse({
      model: this.model,
      messages: this.createInitialMessages(prompt, options),
      response_format: zodResponseFormat(schema, schemaName),
    });

    const parsed = completion.choices[0]?.message.parsed;

    if (!parsed) {
      throw new Error('OpenAI returned no structured content');
    }

    return parsed;
  }

  public async createStructuredCompletionWithTools<T>(
    prompt: string,
    schemaName: string,
    schema: ZodType<T>,
    options?: CompletionOptions,
  ): Promise<T> {
    const context = this.createToolPlanningContext(prompt, options);

    const responseFromToolPhase = await this.tryCreateResponseWithTools(
      context,
      schemaName,
      schema,
      options,
    );

    if (responseFromToolPhase) {
      return responseFromToolPhase;
    }

    return this.generateFinalStructuredResponseWithoutTools(
      context.messages,
      schemaName,
      schema,
      context.audit,
      options,
    );
  }

  private createToolPlanningContext(
    prompt: string,
    options?: CompletionOptions,
  ): ToolPlanningContext {
    return {
      messages: this.createInitialMessages(prompt, options),
      audit: { records: [] },
      executedToolKeys: new Set<string>(),
    };
  }

  private createInitialMessages(
    prompt: string,
    options?: CompletionOptions,
  ): ChatCompletionMessageParam[] {
    return [
      {
        role: 'system',
        content: this.buildSystemPrompt(options),
      },
      {
        role: 'user',
        content: prompt,
      },
    ];
  }

  private async tryCreateResponseWithTools<T>(
    context: ToolPlanningContext,
    schemaName: string,
    schema: ZodType<T>,
    options?: CompletionOptions,
  ): Promise<T | null> {
    const tools = getToolDefinitions();

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: context.messages,
        response_format: zodResponseFormat(schema, schemaName),
        tool_choice: 'auto',
        tools,
      });

      const message = completion.choices[0]?.message;

      if (!message) {
        throw new Error('OpenAI returned no completion message');
      }

      if (message.tool_calls?.length) {
        await this.handleToolCalls(message, context);
        continue;
      }

      const parsed = this.parseStructuredContent(
        message.content,
        schemaName,
        schema,
      );

      const validationResult = this.validateResponse(
        parsed,
        context.audit,
        options,
      );

      if (validationResult.ok) {
        return parsed;
      }

      this.appendValidationRetryMessage(
        context.messages,
        message.content,
        schemaName,
        validationResult,
      );

      return null;
    }

    return null;
  }

  private async handleToolCalls(
    message: {
      content?: string | null;
      tool_calls?: ChatCompletionMessageToolCall[];
    },
    context: ToolPlanningContext,
  ): Promise<void> {
    if (!message.tool_calls?.length) {
      return;
    }

    context.messages.push(this.toAssistantToolCallMessage(message));

    const toolResponses = await Promise.all(
      message.tool_calls.map((toolCall) =>
        this.executeToolCallSafely(toolCall, context),
      ),
    );

    context.messages.push(...toolResponses);
  }

  private async executeToolCallSafely(
    toolCall: ChatCompletionMessageToolCall,
    context: ToolPlanningContext,
  ): Promise<ChatCompletionToolMessageParam> {
    if (toolCall.type !== 'function') {
      throw new Error(`Unsupported tool call type: ${toolCall.type}`);
    }

    const toolName = toolCall.function.name;
    const rawArguments = toolCall.function.arguments;
    const toolKey = this.createToolExecutionKey(toolName, rawArguments);

    if (context.executedToolKeys.has(toolKey)) {
      return this.createDuplicateToolSkippedMessage(toolCall.id);
    }

    context.executedToolKeys.add(toolKey);

    const execution = await this.executeToolCall(
      toolName,
      rawArguments,
      toolCall.id,
    );

    context.audit.records.push(execution.record);

    return execution.toolMessage;
  }

  private createToolExecutionKey(
    toolName: string,
    rawArguments: string | undefined,
  ): string {
    return `${toolName}:${this.normalizeJsonString(rawArguments)}`;
  }

  private normalizeJsonString(rawJson: string | undefined): string {
    if (!rawJson) {
      return '{}';
    }

    try {
      return JSON.stringify(this.sortObjectKeys(JSON.parse(rawJson)));
    } catch {
      return rawJson;
    }
  }

  private sortObjectKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sortObjectKeys(item));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = this.sortObjectKeys(
          (value as Record<string, unknown>)[key],
        );
        return sorted;
      }, {});
  }

  private createDuplicateToolSkippedMessage(
    toolCallId: string,
  ): ChatCompletionToolMessageParam {
    return {
      role: 'tool',
      content: JSON.stringify({
        ok: true,
        skipped: true,
        reason: 'Duplicate tool call skipped',
      }),
      tool_call_id: toolCallId,
    };
  }

  /**
   * מכאן והלאה אסור להריץ tools.
   * אם יש צורך בתיקון — מבקשים רק JSON מתוקן, ללא tools.
   */
  private async generateFinalStructuredResponseWithoutTools<T>(
    messages: ChatCompletionMessageParam[],
    schemaName: string,
    schema: ZodType<T>,
    audit: ToolExecutionAudit,
    options?: CompletionOptions,
  ): Promise<T> {
    let lastErrorMessage = '';

    for (
      let validationAttempt = 0;
      validationAttempt <= MAX_VALIDATION_RETRIES;
      validationAttempt += 1
    ) {
      const finalCompletion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          ...messages,
          {
            role: 'user',
            content: this.buildFinalResponsePrompt(
              schemaName,
              lastErrorMessage,
              options,
            ),
          },
        ],
        response_format: zodResponseFormat(schema, schemaName),
      });

      const finalMessage = finalCompletion.choices[0]?.message;

      if (!finalMessage) {
        throw new Error('OpenAI returned no completion message');
      }

      try {
        const parsed = this.parseStructuredContent(
          finalMessage.content,
          schemaName,
          schema,
        );

        const validationResult = this.validateResponse(parsed, audit, options);

        if (validationResult.ok) {
          return parsed;
        }

        lastErrorMessage = validationResult.errorMessage;

        this.appendValidationRetryMessage(
          messages,
          finalMessage.content,
          schemaName,
          validationResult,
        );
      } catch (error) {
        lastErrorMessage =
          error instanceof Error ? error.message : 'Unknown validation error';

        if (validationAttempt >= MAX_VALIDATION_RETRIES) {
          throw error;
        }

        this.appendJsonParseRetryMessage(
          messages,
          finalMessage.content,
          schemaName,
          lastErrorMessage,
        );
      }
    }

    throw new Error(`OpenAI failed to produce a valid ${schemaName} response`);
  }

  private buildFinalResponsePrompt(
    schemaName: string,
    lastErrorMessage: string,
    options?: CompletionOptions,
  ): string {
    return [
      `Return the final ${schemaName} JSON now.`,
      `Do not use tools.`,
      ...this.getFinalResponseInstructions(options),
      lastErrorMessage
        ? `Fix these validation errors from the previous response:\n${lastErrorMessage}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private getFinalResponseInstructions(options?: CompletionOptions): string[] {
    return options?.finalResponseInstructions ?? DEFAULT_FINAL_RESPONSE_INSTRUCTIONS;
  }

  private appendValidationRetryMessage(
    messages: ChatCompletionMessageParam[],
    invalidContent: unknown,
    schemaName: string,
    validationResult: Exclude<ToolResponseValidationResult, { ok: true }>,
  ): void {
    messages.push(this.toAssistantTextMessage(invalidContent));

    messages.push({
      role: 'user',
      content:
        validationResult.retryMessage ??
        [
          `Your previous response was invalid for ${schemaName}.`,
          `Return a corrected JSON response.`,
          `Do not use tools.`,
          `Validation error: ${validationResult.errorMessage}`,
        ].join('\n'),
    });
  }

  private appendJsonParseRetryMessage(
    messages: ChatCompletionMessageParam[],
    invalidContent: unknown,
    schemaName: string,
    errorMessage: string,
  ): void {
    messages.push(this.toAssistantTextMessage(invalidContent));

    messages.push({
      role: 'user',
      content: [
        `Your previous response was invalid for ${schemaName}.`,
        `Return a corrected JSON response.`,
        `Do not use tools.`,
        `Fix these validation errors:`,
        errorMessage,
        ``,
        `Important rules:`,
        ...DEFAULT_FINAL_RESPONSE_INSTRUCTIONS.map(
          (instruction) => `- ${instruction}`,
        ),
      ].join('\n'),
    });
  }

  private validateResponse(
    parsed: unknown,
    audit: ToolExecutionAudit,
    options?: CompletionOptions,
  ): ToolResponseValidationResult {
    return options?.validateParsedResponse?.(parsed, audit) ?? { ok: true };
  }

  private buildSystemPrompt(options?: CompletionOptions): string {
    if (!options?.systemPromptAppendix) {
      return SYSTEM_PROMPT;
    }

    return `${SYSTEM_PROMPT}\n\n${options.systemPromptAppendix}`;
  }

  private toAssistantToolCallMessage(message: {
    content?: string | null;
    tool_calls?: ChatCompletionMessageToolCall[];
  }): ChatCompletionAssistantMessageParam {
    return {
      role: 'assistant',
      content: typeof message.content === 'string' ? message.content : null,
      tool_calls: message.tool_calls,
    };
  }

  private toAssistantTextMessage(
    content: unknown,
  ): ChatCompletionAssistantMessageParam {
    return {
      role: 'assistant',
      content: this.extractTextContent(content) || null,
    };
  }

  private parseStructuredContent<T>(
    content: unknown,
    schemaName: string,
    schema: ZodType<T>,
  ): T {
    const text = this.extractTextContent(content);

    if (!text) {
      throw new Error(`OpenAI returned no content for ${schemaName}`);
    }

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(text);
    } catch (error) {
      throw new Error(
        `OpenAI returned invalid JSON for ${schemaName}: ${
          error instanceof Error ? error.message : 'Unknown parse error'
        }`,
      );
    }

    return schema.parse(parsedJson);
  }

  private extractTextContent(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }

    if (!Array.isArray(content)) {
      return '';
    }

    return content
      .map((part) => {
        if (
          part &&
          typeof part === 'object' &&
          'type' in part &&
          part.type === 'text' &&
          'text' in part &&
          typeof part.text === 'string'
        ) {
          return part.text;
        }

        return '';
      })
      .join('');
  }

  private async executeToolCall(
    toolName: string,
    rawArguments: string | undefined,
    toolCallId: string,
  ): Promise<{
    toolMessage: ChatCompletionToolMessageParam;
    record: ToolExecutionRecord;
  }> {
    const handler = getToolHandler(toolName);

    if (!handler) {
      throw new Error(`No handler found for tool: ${toolName}`);
    }

    let args: unknown;

    try {
      args = rawArguments ? JSON.parse(rawArguments) : {};
    } catch (error) {
      return {
        toolMessage: {
          role: 'tool',
          content: JSON.stringify({
            ok: false,
            error: `Malformed tool arguments: ${
              error instanceof Error ? error.message : 'unknown parse error'
            }`,
          }),
          tool_call_id: toolCallId,
        },
        record: {
          toolName,
          args: rawArguments ?? {},
          succeeded: false,
        },
      };
    }

    try {
      const result = await handler(args);

      return {
        toolMessage: {
          role: 'tool',
          content: typeof result === 'string' ? result : JSON.stringify(result),
          tool_call_id: toolCallId,
        },
        record: {
          toolName,
          args,
          succeeded: true,
          result,
        },
      };
    } catch (error) {
      return {
        toolMessage: {
          role: 'tool',
          content: JSON.stringify({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Unknown tool execution error',
          }),
          tool_call_id: toolCallId,
        },
        record: {
          toolName,
          args,
          succeeded: false,
        },
      };
    }
  }
}