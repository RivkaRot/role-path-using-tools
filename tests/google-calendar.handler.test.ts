import { beforeEach, describe, expect, it, vi } from 'vitest';

const { insert, calendar, getAuthClient } = vi.hoisted(() => {
  const insertMock = vi.fn();
  const calendarMock = vi.fn(() => ({
    events: {
      insert: insertMock,
    },
  }));
  const getAuthClientMock = vi.fn();

  return {
    insert: insertMock,
    calendar: calendarMock,
    getAuthClient: getAuthClientMock,
  };
});

vi.mock('googleapis', () => ({
  google: {
    calendar,
  },
}));

vi.mock('../src/tools/handlers/auth.js', () => ({
  getAuthClient,
}));

import { createEvent } from '../src/tools/handlers/google-calendar.handler.js';

describe('google-calendar handler', () => {
  beforeEach(() => {
    insert.mockReset();
    calendar.mockClear();
    getAuthClient.mockReset();
  });

  it('creates a real calendar event when credentials are available', async () => {
    getAuthClient.mockResolvedValue({ token: 'auth' });
    insert.mockResolvedValue({
      data: {
        id: 'event-123',
        htmlLink: 'https://calendar.google.com/event?eid=123',
      },
    });

    await expect(
      createEvent({
        title: 'Finish React review',
        startDateTime: '2026-06-25T15:00:00.000Z',
        endDateTime: '2026-06-25T16:00:00.000Z',
      }),
    ).resolves.toEqual({
      id: 'event-123',
      htmlLink: 'https://calendar.google.com/event?eid=123',
    });

    expect(calendar).toHaveBeenCalledWith({
      version: 'v3',
      auth: { token: 'auth' },
    });
    expect(insert).toHaveBeenCalledOnce();
  });

  it('returns a draft calendar link when Google default credentials are missing', async () => {
    getAuthClient.mockResolvedValue({ token: 'auth' });
    insert.mockRejectedValue(
      new Error(
        'Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.',
      ),
    );

    await expect(
      createEvent({
        title: 'Finish React review',
        startDateTime: '2026-06-25T15:00:00.000Z',
        endDateTime: '2026-06-25T16:00:00.000Z',
      }),
    ).resolves.toEqual({
      id: expect.stringMatching(/^draft-/),
      htmlLink:
        'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Finish+React+review&dates=20260625T150000Z%2F20260625T160000Z',
    });
  });

  it('still throws unexpected calendar errors', async () => {
    getAuthClient.mockResolvedValue({ token: 'auth' });
    insert.mockRejectedValue(new Error('calendar quota exceeded'));

    await expect(
      createEvent({
        title: 'Finish React review',
        startDateTime: '2026-06-25T15:00:00.000Z',
        endDateTime: '2026-06-25T16:00:00.000Z',
      }),
    ).rejects.toThrow('calendar quota exceeded');
  });
});
