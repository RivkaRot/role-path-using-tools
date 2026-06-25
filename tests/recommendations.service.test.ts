import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatCompletionClient } from '../src/clients/openai-chat.client.js';
import type {
  AssessmentSession,
  AssessmentSessionRepository,
} from '../src/repositories/assessment-session.repository.js';
import { RecommendationsService } from '../src/services/recommendations.service.js';
import {
  generatedAdaptiveQuestionsFixture,
  generatedAdaptiveRecommendationsFixture,
  generatedRecommendationsFixture,
  questionsFixture,
  recommendationsFixture,
} from './fixtures.js';

describe('RecommendationsService', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('returns and saves generated recommendations with model-provided calendar events', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-24T09:30:00.000Z'));

    const createStructuredCompletion = vi.fn();
    const createStructuredCompletionWithTools = vi.fn().mockResolvedValue(generatedRecommendationsFixture);
    const client: ChatCompletionClient = {
      createStructuredCompletion,
      createStructuredCompletionWithTools,
    };
    const updateSession = vi.fn();
    const repository = createRepository(updateSession, {
      questionRoundCount: 3,
      activeQuestionRound: 3,
      questions: [
        {
          id: 'q1',
          text: 'What is React?',
          options: [
            { id: 'o1', label: 'A library' },
            { id: 'o2', label: 'A database' },
          ],
        },
        {
          id: 'q2',
          text: 'What is TypeScript?',
          options: [
            { id: 'o1', label: 'A typed superset of JavaScript' },
            { id: 'o2', label: 'A CSS framework' },
          ],
        },
      ],
      questionRounds: [
        {
          roundNumber: 1,
          questions: [
            {
              id: 'q1',
              text: 'What is React?',
              options: [
                { id: 'o1', label: 'A library' },
                { id: 'o2', label: 'A database' },
              ],
            },
            {
              id: 'q2',
              text: 'What is TypeScript?',
              options: [
                { id: 'o1', label: 'A typed superset of JavaScript' },
                { id: 'o2', label: 'A CSS framework' },
              ],
            },
          ],
          generatedAt: new Date().toISOString(),
        },
      ],
    });

    const service = new RecommendationsService(client, repository);
    const input = {
      sessionId: crypto.randomUUID(),
      answers: [
        { question: 'q1', selectedAnswer: 'o1' },
        { question: 'q2', selectedAnswer: 'o1' },
        { question: 'Question 3', selectedAnswer: 'Beginner' },
        { question: 'Question 4', selectedAnswer: 'Beginner' },
        { question: 'Question 5', selectedAnswer: 'Beginner' },
      ],
    };

    await expect(service.generate(input)).resolves.toEqual(recommendationsFixture);
    expect(createStructuredCompletion).not.toHaveBeenCalled();
    expect(createStructuredCompletionWithTools).toHaveBeenCalledOnce();
    expect(updateSession).toHaveBeenCalledOnce();

    const [prompt, schemaName, , options] = createStructuredCompletionWithTools.mock.calls[0] ?? [];
    expect(prompt).toContain('Assessment history');
    expect(prompt).toContain('Question: What is React?');
    expect(prompt).toContain('Selected answer: A library');
    expect(prompt).toContain('Question: What is TypeScript?');
    expect(prompt).toContain('Selected answer: A typed superset of JavaScript');
    expect(prompt).toContain('you must call create_calendar_event exactly once per topic before returning the final JSON');
    expect(prompt).toContain('required part of producing recommendations');
    expect(prompt).toContain('Every calendarEvents[].eventId and calendarEvents[].calendarLink value must come from the tool response');
    expect(prompt).toContain('Do not return recommendations until all 3 required calendar event creation attempts have been completed');
    expect(prompt).toContain('Current server date');
    expect(prompt).toContain('18:00 to 18:30');
    expect(schemaName).toBe('generated_recommendations_response');
    expect(options.systemPromptAppendix).toContain('Never continue past 3 total question rounds.');
    expect(updateSession).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        recommendations: recommendationsFixture,
      }),
    );
  });

  it('uses the adaptive recommendation decision without a second model call', async () => {
    const createStructuredCompletionWithTools = vi
      .fn()
      .mockResolvedValue(generatedAdaptiveRecommendationsFixture);
    const client: ChatCompletionClient = {
      createStructuredCompletion: vi.fn(),
      createStructuredCompletionWithTools,
    };
    const updateSession = vi.fn();
    const repository = createRepository(updateSession, {
      questionRoundCount: 1,
      activeQuestionRound: 1,
      questions: questionsForRound('Round 1'),
      questionRounds: [
        {
          roundNumber: 1,
          questions: questionsForRound('Round 1'),
          generatedAt: new Date().toISOString(),
        },
      ],
    });

    const service = new RecommendationsService(client, repository);
    const result = await service.generate({
      sessionId: crypto.randomUUID(),
      answers: Array.from({ length: 5 }, (_, index) => ({
        question: `q${index + 1}`,
        selectedAnswer: 'a',
      })),
    });

    expect(result.type).toBe('recommendations');
    if (result.type !== 'recommendations') {
      throw new Error('Expected recommendations result');
    }
    expect(result.calendarEvents).toEqual(recommendationsFixture.calendarEvents);
    expect(createStructuredCompletionWithTools).toHaveBeenCalledOnce();
    const [prompt, schemaName] = createStructuredCompletionWithTools.mock.calls[0] ?? [];
    expect(prompt).toContain('If the assessment is complete enough to identify the main gaps, return type "recommendations".');
    expect(prompt).toContain('you must call create_calendar_event exactly once per topic before returning the final JSON');
    expect(prompt).toContain('Do not return recommendations until all 3 required calendar event creation attempts have been completed');
    expect(schemaName).toBe('generated_adaptive_assessment_response');
  });

  it('returns follow-up questions and stores the next round', async () => {
    const client: ChatCompletionClient = {
      createStructuredCompletion: vi.fn(),
      createStructuredCompletionWithTools: vi
        .fn()
        .mockResolvedValue(generatedAdaptiveQuestionsFixture),
    };
    const updateSession = vi.fn();
    const repository = createRepository(updateSession, {
      questionRoundCount: 1,
      activeQuestionRound: 1,
      questions: questionsForRound('Round 1'),
      questionRounds: [
        {
          roundNumber: 1,
          questions: questionsForRound('Round 1'),
          generatedAt: new Date().toISOString(),
        },
      ],
    });

    const sessionId = crypto.randomUUID();
    const service = new RecommendationsService(client, repository);
    const result = await service.generate({
      sessionId,
      answers: Array.from({ length: 5 }, (_, index) => ({
        question: `q${index + 1}`,
        selectedAnswer: 'a',
      })),
    });

    expect(result).toEqual({
      type: 'questions',
      sessionId,
      questions: questionsFixture.questions,
    });
    expect(updateSession).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        questionRoundCount: 2,
        activeQuestionRound: 2,
        answerHistory: expect.arrayContaining([
          expect.objectContaining({ roundNumber: 1 }),
        ]),
      }),
    );
  });

  it('forces final recommendations after three total rounds through the tool-enabled path', async () => {
    const createStructuredCompletion = vi.fn();
    const createStructuredCompletionWithTools = vi.fn().mockResolvedValue(generatedRecommendationsFixture);
    const client: ChatCompletionClient = {
      createStructuredCompletion,
      createStructuredCompletionWithTools,
    };
    const updateSession = vi.fn();
    const repository = createRepository(updateSession, {
      questionRoundCount: 3,
      activeQuestionRound: 3,
      questions: questionsForRound('Round 3'),
      questionRounds: [
        { roundNumber: 1, questions: questionsForRound('Round 1'), generatedAt: new Date().toISOString() },
        { roundNumber: 2, questions: questionsForRound('Round 2'), generatedAt: new Date().toISOString() },
        { roundNumber: 3, questions: questionsForRound('Round 3'), generatedAt: new Date().toISOString() },
      ],
      answerHistory: [
        {
          roundNumber: 1,
          rawAnswers: [{ question: 'q1', selectedAnswer: 'a' }],
          resolvedAnswers: [{ question: 'Round 1 Question 1', selectedAnswer: 'Beginner' }],
          answeredAt: new Date().toISOString(),
        },
        {
          roundNumber: 2,
          rawAnswers: [{ question: 'q1', selectedAnswer: 'a' }],
          resolvedAnswers: [{ question: 'Round 2 Question 1', selectedAnswer: 'Beginner' }],
          answeredAt: new Date().toISOString(),
        },
      ],
    });

    const service = new RecommendationsService(client, repository);
    const result = await service.generate({
      sessionId: crypto.randomUUID(),
      answers: Array.from({ length: 5 }, (_, index) => ({
        question: `q${index + 1}`,
        selectedAnswer: 'a',
      })),
    });

    expect(result.type).toBe('recommendations');
    expect(createStructuredCompletion).not.toHaveBeenCalled();
    expect(createStructuredCompletionWithTools).toHaveBeenCalledOnce();
    const [prompt, schemaName] = createStructuredCompletionWithTools.mock.calls[0] ?? [];
    expect(prompt).toContain('Round 1');
    expect(prompt).toContain('Round 2');
    expect(prompt).toContain('Current submitted answers for round 3');
    expect(schemaName).toBe('generated_recommendations_response');
  });

  it('does not persist recommendations when verified calendar tool usage is missing', async () => {
    const createStructuredCompletionWithTools = vi
      .fn()
      .mockRejectedValue(new Error('Missing required create_calendar_event tool usage'));
    const client: ChatCompletionClient = {
      createStructuredCompletion: vi.fn(),
      createStructuredCompletionWithTools,
    };
    const updateSession = vi.fn();
    const repository = createRepository(updateSession, {
      questionRoundCount: 3,
      activeQuestionRound: 3,
      questions: questionsForRound('Round 3'),
      questionRounds: [
        { roundNumber: 1, questions: questionsForRound('Round 1'), generatedAt: new Date().toISOString() },
        { roundNumber: 2, questions: questionsForRound('Round 2'), generatedAt: new Date().toISOString() },
        { roundNumber: 3, questions: questionsForRound('Round 3'), generatedAt: new Date().toISOString() },
      ],
    });

    const service = new RecommendationsService(client, repository);

    await expect(
      service.generate({
        sessionId: crypto.randomUUID(),
        answers: Array.from({ length: 5 }, (_, index) => ({
          question: `q${index + 1}`,
          selectedAnswer: 'a',
        })),
      }),
    ).rejects.toThrow('Missing required create_calendar_event tool usage');

    expect(updateSession).not.toHaveBeenCalled();
  });
});

function createRepository(
  updateSession: AssessmentSessionRepository['updateSession'],
  overrides: Partial<AssessmentSession>,
): AssessmentSessionRepository {
  return {
    createSession: vi.fn(),
    getSessionById: vi.fn().mockResolvedValue({
      sessionId: crypto.randomUUID(),
      currentRole: 'Frontend Developer',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      questionRoundCount: 1,
      activeQuestionRound: 1,
      questions: [],
      questionRounds: [],
      answerHistory: [],
      aiHistory: [],
      ...overrides,
    }),
    updateSession,
  };
}

function questionsForRound(prefix: string) {
  return Array.from({ length: 5 }, (_, index) => ({
    id: `q${index + 1}`,
    text: `${prefix} Question ${index + 1}`,
    options: [
      { id: 'a', label: 'Beginner' },
      { id: 'b', label: 'Experienced' },
    ],
  }));
}
