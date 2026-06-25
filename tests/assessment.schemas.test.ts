import { describe, expect, it } from 'vitest';
import {
  generatedRecommendationsResponseSchema,
  questionsRequestSchema,
  questionsResponseSchema,
  recommendationsRequestSchema,
  recommendationsResponseSchema,
  resourceSchema,
} from '../src/schemas/assessment.schemas.js';
import { recommendationsFixture } from './fixtures.js';

describe('assessment request schemas', () => {
  it('accepts a valid programming role', () => {
    expect(questionsRequestSchema.parse({ currentRole: 'C++ Developer' })).toEqual({
      currentRole: 'C++ Developer',
    });
  });

  it.each(['', 'a', '<script>alert(1)</script>'])('rejects invalid role %s', (currentRole) => {
    expect(questionsRequestSchema.safeParse({ currentRole }).success).toBe(false);
  });

  it('requires exactly five answers', () => {
    const result = recommendationsRequestSchema.safeParse({
      sessionId: crypto.randomUUID(),
      answers: [{ question: 'Question?', selectedAnswer: 'Answer' }],
    });
    expect(result.success).toBe(false);
  });

  it('requires a sessionId in the questions response', () => {
    expect(
      questionsResponseSchema.safeParse({
        questions: Array.from({ length: 5 }, (_, index) => ({
          id: `q${index + 1}`,
          text: `Question ${index + 1}`,
          options: [
            { id: 'a', label: 'Beginner' },
            { id: 'b', label: 'Experienced' },
          ],
        })),
      }).success,
    ).toBe(false);
  });

  it('requires HTTPS resource URLs', () => {
    expect(
      resourceSchema.safeParse({
        title: 'תיעוד',
        description: 'מסמכי עזר',
        url: 'http://example.com',
      }).success,
    ).toBe(false);
  });

  it('accepts generated recommendations with three topics and four resources each', () => {
    expect(
      generatedRecommendationsResponseSchema.safeParse({
        topics: recommendationsFixture.topics,
        calendarEvents: recommendationsFixture.calendarEvents,
      }).success,
    ).toBe(true);
  });

  it('rejects generated recommendations with fewer than three topics', () => {
    expect(
      generatedRecommendationsResponseSchema.safeParse({
        topics: recommendationsFixture.topics.slice(0, 2),
        calendarEvents: recommendationsFixture.calendarEvents,
      }).success,
    ).toBe(false);
  });

  it('rejects generated recommendations with fewer than four resources', () => {
    expect(
      generatedRecommendationsResponseSchema.safeParse({
        topics: [
          {
            ...recommendationsFixture.topics[0],
            resources: recommendationsFixture.topics[0]?.resources.slice(0, 3) ?? [],
          },
          ...recommendationsFixture.topics.slice(1),
        ],
        calendarEvents: recommendationsFixture.calendarEvents,
      }).success,
    ).toBe(false);
  });

  it('rejects generated recommendations with learningDays lower than one', () => {
    expect(
      generatedRecommendationsResponseSchema.safeParse({
        topics: [
          {
            ...recommendationsFixture.topics[0],
            learningDays: 0,
          },
          ...recommendationsFixture.topics.slice(1),
        ],
        calendarEvents: recommendationsFixture.calendarEvents,
      }).success,
    ).toBe(false);
  });

  it('rejects generated recommendations with fewer than three calendar events', () => {
    expect(
      generatedRecommendationsResponseSchema.safeParse({
        topics: recommendationsFixture.topics,
        calendarEvents: recommendationsFixture.calendarEvents.slice(0, 2),
      }).success,
    ).toBe(false);
  });

  it('rejects generated recommendations when a calendar event topic does not match a recommendation topic', () => {
    expect(
      generatedRecommendationsResponseSchema.safeParse({
        topics: recommendationsFixture.topics,
        calendarEvents: [
          {
            ...recommendationsFixture.calendarEvents[0],
            topicTitle: 'נושא אחר',
          },
          ...recommendationsFixture.calendarEvents.slice(1),
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects generated recommendations when a calendar event is not scheduled for 18:00 local time', () => {
    expect(
      generatedRecommendationsResponseSchema.safeParse({
        topics: recommendationsFixture.topics,
        calendarEvents: [
          {
            ...recommendationsFixture.calendarEvents[0],
            startDateTime: '2026-06-25T14:00:00.000Z',
          },
          ...recommendationsFixture.calendarEvents.slice(1),
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects generated recommendations when a calendar event is not 30 minutes long', () => {
    expect(
      generatedRecommendationsResponseSchema.safeParse({
        topics: recommendationsFixture.topics,
        calendarEvents: [
          {
            ...recommendationsFixture.calendarEvents[0],
            endDateTime: '2026-06-25T15:45:00.000Z',
          },
          ...recommendationsFixture.calendarEvents.slice(1),
        ],
      }).success,
    ).toBe(false);
  });

  it('validates the final recommendations response including calendar events', () => {
    expect(recommendationsResponseSchema.safeParse(recommendationsFixture).success).toBe(true);
  });
});
