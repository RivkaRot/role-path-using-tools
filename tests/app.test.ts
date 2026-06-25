import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { AppFactory } from '../src/app.js';
import type { ChatCompletionClient } from '../src/clients/openai-chat.client.js';
import {
  generatedAdaptiveRecommendationsFixture,
  generatedAdaptiveQuestionsFixture,
  questionsFixture,
} from './fixtures.js';

function createClient(options: {
  structuredResult?: unknown;
  toolsResult?: unknown;
}): ChatCompletionClient {
  return {
    createStructuredCompletion: vi.fn().mockResolvedValue(options.structuredResult),
    createStructuredCompletionWithTools: vi.fn().mockResolvedValue(options.toolsResult),
  };
}

async function createSessionsFilePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'assessment-sessions-'));
  return join(directory, 'sessions.json');
}

describe('assessment endpoints', () => {
  it('returns five questions with two to four options', async () => {
    const sessionsFilePath = await createSessionsFilePath();
    const response = await request(
      AppFactory.create(createClient({ structuredResult: questionsFixture }), sessionsFilePath),
    )
      .post('/api/v1/questions')
      .send({ currentRole: 'Frontend Developer' });

    expect(response.status).toBe(200);
    expect(response.body.type).toBe('questions');
    expect(response.body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(response.body.questions).toHaveLength(5);
    for (const question of response.body.questions) {
      expect(question.options.length).toBeGreaterThanOrEqual(2);
      expect(question.options.length).toBeLessThanOrEqual(4);
    }

    const savedSessions = JSON.parse(await readFile(sessionsFilePath, 'utf8'));
    expect(savedSessions).toHaveLength(1);
    expect(savedSessions[0].currentRole).toBe('Frontend Developer');
    expect(savedSessions[0].questions).toHaveLength(5);
    expect(savedSessions[0].questionRoundCount).toBe(1);
    expect(savedSessions[0].questionRounds).toHaveLength(1);
    expect(savedSessions[0].aiHistory).toHaveLength(1);
    expect(savedSessions[0].aiHistory[0].step).toBe('questions');
  });

  it('rejects an invalid role', async () => {
    const sessionsFilePath = await createSessionsFilePath();
    const response = await request(
      AppFactory.create(createClient({ structuredResult: questionsFixture }), sessionsFilePath),
    )
      .post('/api/v1/questions')
      .send({ currentRole: '' });
    expect(response.status).toBe(400);
  });

  it('returns follow-up questions when the adaptive decision continues the assessment', async () => {
    const sessionsFilePath = await createSessionsFilePath();
    const app = AppFactory.create(createClient({ structuredResult: questionsFixture }), sessionsFilePath);
    const questionsResponse = await request(app)
      .post('/api/v1/questions')
      .send({ currentRole: 'Frontend Developer' });
    const answers = questionsResponse.body.questions.map(
      (question: { id: string; options: Array<{ id: string }> }) => ({
        question: question.id,
        selectedAnswer: question.options[0]!.id,
      }),
    );

    const response = await request(
      AppFactory.create(createClient({ toolsResult: generatedAdaptiveQuestionsFixture }), sessionsFilePath),
    )
      .post('/api/v1/recommendations')
      .send({ sessionId: questionsResponse.body.sessionId, answers });

    expect(response.status).toBe(200);
    expect(response.body.type).toBe('questions');
    expect(response.body.sessionId).toBe(questionsResponse.body.sessionId);
    expect(response.body.questions).toHaveLength(5);

    const savedSessions = JSON.parse(await readFile(sessionsFilePath, 'utf8'));
    expect(savedSessions[0].questionRoundCount).toBe(2);
    expect(savedSessions[0].activeQuestionRound).toBe(2);
    expect(savedSessions[0].questionRounds).toHaveLength(2);
    expect(savedSessions[0].answerHistory).toHaveLength(1);
    expect(savedSessions[0].aiHistory).toHaveLength(2);
    expect(savedSessions[0].aiHistory[1].step).toBe('questions');
  });

  it('returns three topics with four resources and three calendar events on the final path', async () => {
    const sessionsFilePath = await createSessionsFilePath();
    const app = AppFactory.create(createClient({ structuredResult: questionsFixture }), sessionsFilePath);
    const questionsResponse = await request(app)
      .post('/api/v1/questions')
      .send({ currentRole: 'Frontend Developer' });
    const answers = questionsResponse.body.questions.map(
      (question: { id: string; options: Array<{ id: string }> }) => ({
        question: question.id,
        selectedAnswer: question.options[0]!.id,
      }),
    );
    const response = await request(
      AppFactory.create(
        createClient({ toolsResult: generatedAdaptiveRecommendationsFixture }),
        sessionsFilePath,
      ),
    )
      .post('/api/v1/recommendations')
      .send({ sessionId: questionsResponse.body.sessionId, answers });

    expect(response.status).toBe(200);
    expect(response.body.type).toBe('recommendations');
    expect(response.body.topics).toHaveLength(3);
    expect(response.body.calendarEvents).toHaveLength(3);
    for (const topic of response.body.topics) {
      expect(topic.resources).toHaveLength(4);
      expect(topic.learningDays).toBeGreaterThanOrEqual(1);
    }

    const savedSessions = JSON.parse(await readFile(sessionsFilePath, 'utf8'));
    expect(savedSessions[0].currentRole).toBe('Frontend Developer');
    expect(savedSessions[0].answers).toEqual(answers);
    expect(savedSessions[0].answerHistory).toHaveLength(1);
    expect(savedSessions[0].recommendations.type).toBe('recommendations');
    expect(savedSessions[0].recommendations.topics).toHaveLength(3);
    expect(savedSessions[0].recommendations.calendarEvents).toHaveLength(3);
    expect(savedSessions[0].aiHistory).toHaveLength(2);
    expect(savedSessions[0].aiHistory[1].step).toBe('recommendations');
  });

  it('rejects a recommendation request without five answers', async () => {
    const sessionsFilePath = await createSessionsFilePath();
    const response = await request(
      AppFactory.create(
        createClient({ toolsResult: generatedAdaptiveRecommendationsFixture }),
        sessionsFilePath,
      ),
    )
      .post('/api/v1/recommendations')
      .send({
        sessionId: crypto.randomUUID(),
        answers: [{ question: 'Question', selectedAnswer: 'Answer' }],
      });
    expect(response.status).toBe(400);
  });

  it('returns 404 for an unknown session', async () => {
    const sessionsFilePath = await createSessionsFilePath();
    const response = await request(
      AppFactory.create(
        createClient({ toolsResult: generatedAdaptiveRecommendationsFixture }),
        sessionsFilePath,
      ),
    )
      .post('/api/v1/recommendations')
      .send({
        sessionId: crypto.randomUUID(),
        answers: Array.from({ length: 5 }, (_, index) => ({
          question: `Question ${index + 1}`,
          selectedAnswer: 'Beginner',
        })),
      });

    expect(response.status).toBe(404);
  });
});
