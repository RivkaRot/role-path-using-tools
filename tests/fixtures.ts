import type {
  GeneratedAdaptiveAssessmentResponse,
  GeneratedQuestions,
  RecommendationsResponse,
} from '../src/schemas/assessment.schemas.js';

export const questionsFixture: GeneratedQuestions = {
  questions: Array.from({ length: 5 }, (_, index) => ({
    id: `q${index + 1}`,
    text: `Question ${index + 1}`,
    options: [
      { id: 'a', label: 'Beginner' },
      { id: 'b', label: 'Experienced' },
    ],
  })),
};

const topics = Array.from({ length: 3 }, (_, topicIndex) => ({
  title: `נושא ${topicIndex + 1}`,
  reason: 'המיומנות הזו דורשת חיזוק נוסף.',
  learningDays: topicIndex + 1,
  resources: Array.from({ length: 4 }, (_, resourceIndex) => ({
    title: `משאב ${resourceIndex + 1}`,
    description: 'חומר לימוד מומלץ.',
    url: `https://example.com/topic-${topicIndex + 1}/resource-${resourceIndex + 1}`,
  })),
}));

const calendarEvents = Array.from({ length: 3 }, (_, topicIndex) => ({
  title: `יעד לסיום לימוד: נושא ${topicIndex + 1}`,
  topicTitle: `נושא ${topicIndex + 1}`,
  startDateTime: `2026-06-2${topicIndex + 5}T15:00:00.000Z`,
  endDateTime: `2026-06-2${topicIndex + 5}T15:30:00.000Z`,
  eventId: `event-${topicIndex + 1}`,
  calendarLink: `https://calendar.google.com/event?eid=${topicIndex + 1}`,
}));

export const recommendationsFixture: RecommendationsResponse = {
  type: 'recommendations',
  topics,
  calendarEvents,
};

export const generatedRecommendationsFixture: Omit<RecommendationsResponse, 'type'> = {
  topics,
  calendarEvents,
};

export const generatedAdaptiveQuestionsFixture: GeneratedAdaptiveAssessmentResponse = {
  result: {
    type: 'questions',
    questions: questionsFixture.questions,
  },
};

export const generatedAdaptiveRecommendationsFixture: GeneratedAdaptiveAssessmentResponse = {
  result: {
    type: 'recommendations',
    topics,
    calendarEvents,
  },
};
