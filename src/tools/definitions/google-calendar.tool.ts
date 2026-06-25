export const createCalendarEvent = {
  type: 'function',
  function: {
    name: 'create_calendar_event',
    description:
      'Create a Google Calendar learning deadline event for a recommendation topic. Use only for recommendation deadlines. Provide ISO datetime strings for startDateTime and endDateTime.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Calendar event title, for example: יעד לסיום לימוד: React state management',
        },
        startDateTime: {
          type: 'string',
          description: 'Event start datetime as an ISO 8601 string.',
        },
        endDateTime: {
          type: 'string',
          description: 'Event end datetime as an ISO 8601 string.',
        },
      },
      required: ['title', 'startDateTime', 'endDateTime'],
    },
  },
};
