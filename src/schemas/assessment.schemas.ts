import { z } from 'zod';

const LEARNING_DEADLINE_HOUR = 18;
const LEARNING_DEADLINE_MINUTE = 0;
const LEARNING_EVENT_DURATION_MINUTES = 30;
const SERVER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export const roleSchema = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .regex(/^[\p{L}\p{N} .+#/&()-]+$/u, 'Role contains unsupported characters');

export const questionsRequestSchema = z.object({
  currentRole: roleSchema,
});

export const sessionIdSchema = z.string().uuid();

export const questionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

export const questionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  options: z.array(questionOptionSchema).min(2).max(4),
});

export const generatedQuestionsSchema = z.object({
  questions: z.array(questionSchema).length(5),
});

export const questionsResponseSchema = generatedQuestionsSchema.extend({
  type: z.literal('questions'),
  sessionId: sessionIdSchema,
});

export const answerSchema = z.object({
  question: z.string().trim().min(1).max(500),
  selectedAnswer: z.string().trim().min(1).max(300),
});

export const recommendationsRequestSchema = z.object({
  sessionId: sessionIdSchema,
  answers: z.array(answerSchema).length(5),
});

export const resourceSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  url: z
    .string()
    .min(1)
    .refine(
      (url) => {
        try {
          const parsed = new URL(url);
          return parsed.protocol === 'https:';
        } catch {
          return false;
        }
      },
      'Resource URL must be a valid HTTPS URL',
    ),
});

export const topicSchema = z.object({
  title: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  learningDays: z.number().int().min(1),
  resources: z.array(resourceSchema).length(4),
});

export const calendarEventSchema = z.object({
  title: z.string().trim().min(1),
  topicTitle: z.string().trim().min(1),
  startDateTime: z.string().describe('ISO 8601 date-time string'),
  endDateTime: z.string().describe('ISO 8601 date-time string'),
  eventId: z.string().trim().min(1),
  calendarLink: z.string().trim().nullable(),
});

const generatedRecommendationsResponseSchemaBase = z.object({
  topics: z.array(topicSchema).length(3),
  calendarEvents: z.array(calendarEventSchema).length(3),
});

const generatedAdaptiveRecommendationsResponseSchemaBase =
  generatedRecommendationsResponseSchemaBase.extend({
    type: z.literal('recommendations'),
  });

const recommendationsResponseSchemaBase = generatedRecommendationsResponseSchemaBase.extend({
  type: z.literal('recommendations'),
});

export const generatedRecommendationsResponseSchema = withLearningDeadlineValidation(
  generatedRecommendationsResponseSchemaBase,
);

export const generatedAdaptiveQuestionsResponseSchema = generatedQuestionsSchema.extend({
  type: z.literal('questions'),
});

export const generatedAdaptiveRecommendationsResponseSchema = withLearningDeadlineValidation(
  generatedAdaptiveRecommendationsResponseSchemaBase,
);

export const generatedAdaptiveAssessmentResponseSchema = z
  .object({
    result: z.discriminatedUnion('type', [
      generatedAdaptiveQuestionsResponseSchema,
      generatedAdaptiveRecommendationsResponseSchemaBase,
    ]),
  })
  .superRefine((value, context) => {
    if (value.result.type === 'recommendations') {
      addLearningDeadlineIssues(value.result, context, ['result']);
    }
  });

export const recommendationsResponseSchema = withLearningDeadlineValidation(
  recommendationsResponseSchemaBase,
);

export const adaptiveRecommendationsResponseSchema = z
  .discriminatedUnion('type', [questionsResponseSchema, recommendationsResponseSchemaBase])
  .superRefine((value, context) => {
    if (value.type === 'recommendations') {
      addLearningDeadlineIssues(value, context);
    }
  });

export type QuestionsRequest = z.infer<typeof questionsRequestSchema>;
export type GeneratedQuestions = z.infer<typeof generatedQuestionsSchema>;
export type QuestionsResponse = z.infer<typeof questionsResponseSchema>;
export type RecommendationsRequest = z.infer<typeof recommendationsRequestSchema>;
export type RecommendationsResponse = z.infer<typeof recommendationsResponseSchema>;
export type GeneratedAdaptiveAssessmentResponse = z.infer<
  typeof generatedAdaptiveAssessmentResponseSchema
>;
export type AdaptiveRecommendationsResponse = z.infer<
  typeof adaptiveRecommendationsResponseSchema
>;

type RecommendationCalendarShape = {
  topics: Array<{ title: string }>;
  calendarEvents: Array<{
    topicTitle: string;
    startDateTime: string;
    endDateTime: string;
  }>;
};

function withLearningDeadlineValidation<TSchema extends z.AnyZodObject>(
  schema: TSchema,
): z.ZodEffects<TSchema, z.output<TSchema>, z.input<TSchema>> {
  return schema.superRefine((value, context) =>
    addLearningDeadlineIssues(value as RecommendationCalendarShape, context),
  );
}

function addLearningDeadlineIssues(
  value: RecommendationCalendarShape,
  context: z.RefinementCtx,
  basePath: Array<string | number> = [],
) {
  const topicTitles = value.topics.map((topic) => topic.title);
  const eventTopicTitles = value.calendarEvents.map((event) => event.topicTitle);

  if (new Set(eventTopicTitles).size !== value.calendarEvents.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Each calendar event must map to a unique topic title',
      path: [...basePath, 'calendarEvents'],
    });
  }

  for (const topicTitle of topicTitles) {
    if (!eventTopicTitles.includes(topicTitle)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Missing calendar event for topic "${topicTitle}"`,
        path: [...basePath, 'calendarEvents'],
      });
    }
  }

  for (const [index, calendarEvent] of value.calendarEvents.entries()) {
    const learningWindowValidation = validateLearningDeadlineWindow(
      calendarEvent.startDateTime,
      calendarEvent.endDateTime,
    );

    if (!learningWindowValidation.valid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: learningWindowValidation.message,
        path: [...basePath, 'calendarEvents', index],
      });
    }
  }
}

function validateLearningDeadlineWindow(
  startDateTime: string,
  endDateTime: string,
): { valid: true } | { valid: false; message: string } {
  const start = new Date(startDateTime);
  const end = new Date(endDateTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { valid: false, message: 'Calendar events must use valid ISO datetimes' };
  }

  if (end.getTime() - start.getTime() !== LEARNING_EVENT_DURATION_MINUTES * 60 * 1000) {
    return {
      valid: false,
      message: `Calendar events must last exactly ${LEARNING_EVENT_DURATION_MINUTES} minutes`,
    };
  }

  const localStart = getTimeZoneClockParts(start, SERVER_TIME_ZONE);
  if (
    localStart.hour !== LEARNING_DEADLINE_HOUR
    || localStart.minute !== LEARNING_DEADLINE_MINUTE
  ) {
    return {
      valid: false,
      message: `Calendar events must start at ${String(LEARNING_DEADLINE_HOUR).padStart(2, '0')}:${String(LEARNING_DEADLINE_MINUTE).padStart(2, '0')} in ${SERVER_TIME_ZONE}`,
    };
  }

  return { valid: true };
}

function getTimeZoneClockParts(date: Date, timeZone: string): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 'NaN');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 'NaN');

  return { hour, minute };
}
