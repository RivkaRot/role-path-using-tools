import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { FileAssessmentSessionRepository } from '../src/repositories/file-assessment-session.repository.js';
import { recommendationsFixture } from './fixtures.js';

async function createRepository() {
  const directory = await mkdtemp(join(tmpdir(), 'assessment-session-repo-'));
  const filePath = join(directory, 'sessions.json');
  return {
    filePath,
    repository: new FileAssessmentSessionRepository(filePath),
  };
}

describe('FileAssessmentSessionRepository', () => {
  it('creates and reads a session', async () => {
    const { repository } = await createRepository();
    const session = {
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
    };

    await repository.createSession(session);

    await expect(repository.getSessionById(session.sessionId)).resolves.toEqual(session);
  });

  it('updates a session with follow-up rounds and recommendations', async () => {
    const { repository } = await createRepository();
    const sessionId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await repository.createSession({
      sessionId,
      currentRole: 'Frontend Developer',
      createdAt,
      updatedAt: createdAt,
      questionRoundCount: 1,
      activeQuestionRound: 1,
      questions: [],
      questionRounds: [],
      answerHistory: [],
      aiHistory: [],
    });

    const adaptiveUpdatedAt = new Date().toISOString();
    await repository.updateSession(sessionId, {
      updatedAt: adaptiveUpdatedAt,
      questions: [
        {
          id: 'q1',
          text: 'Question 1',
          options: [
            { id: 'a', label: 'Beginner' },
            { id: 'b', label: 'Experienced' },
          ],
        },
      ],
      questionRoundCount: 2,
      activeQuestionRound: 2,
      questionRounds: [
        {
          roundNumber: 1,
          questions: [],
          generatedAt: createdAt,
        },
        {
          roundNumber: 2,
          questions: [
            {
              id: 'q1',
              text: 'Question 1',
              options: [
                { id: 'a', label: 'Beginner' },
                { id: 'b', label: 'Experienced' },
              ],
            },
          ],
          generatedAt: adaptiveUpdatedAt,
        },
      ],
      answerHistory: [
        {
          roundNumber: 1,
          rawAnswers: [{ question: 'q1', selectedAnswer: 'a' }],
          resolvedAnswers: [{ question: 'Question 0', selectedAnswer: 'Beginner' }],
          answeredAt: adaptiveUpdatedAt,
        },
      ],
      aiHistoryEntry: {
        step: 'questions',
        requestPrompt: 'adaptive prompt',
        responsePayload: {
          result: {
            type: 'questions',
            questions: [
              {
                id: 'q1',
                text: 'Question 1',
                options: [
                  { id: 'a', label: 'Beginner' },
                  { id: 'b', label: 'Experienced' },
                ],
              },
            ],
          },
        },
        createdAt: adaptiveUpdatedAt,
      },
    });

    const finalUpdatedAt = new Date().toISOString();
    await repository.updateSession(sessionId, {
      updatedAt: finalUpdatedAt,
      answers: [{ question: 'q1', selectedAnswer: 'a' }],
      answerHistory: [
        {
          roundNumber: 1,
          rawAnswers: [{ question: 'q1', selectedAnswer: 'a' }],
          resolvedAnswers: [{ question: 'Question 0', selectedAnswer: 'Beginner' }],
          answeredAt: adaptiveUpdatedAt,
        },
        {
          roundNumber: 2,
          rawAnswers: [{ question: 'q1', selectedAnswer: 'a' }],
          resolvedAnswers: [{ question: 'Question 1', selectedAnswer: 'Beginner' }],
          answeredAt: finalUpdatedAt,
        },
      ],
      recommendations: recommendationsFixture,
      aiHistoryEntry: {
        step: 'recommendations',
        requestPrompt: 'final prompt',
        responsePayload: recommendationsFixture,
        createdAt: finalUpdatedAt,
      },
    });

    await expect(repository.getSessionById(sessionId)).resolves.toMatchObject({
      sessionId,
      answers: [{ question: 'q1', selectedAnswer: 'a' }],
      questionRoundCount: 2,
      activeQuestionRound: 2,
      recommendations: recommendationsFixture,
      questionRounds: [
        { roundNumber: 1 },
        { roundNumber: 2 },
      ],
      answerHistory: [
        { roundNumber: 1 },
        { roundNumber: 2 },
      ],
      aiHistory: [
        {
          step: 'questions',
          requestPrompt: 'adaptive prompt',
        },
        {
          step: 'recommendations',
          requestPrompt: 'final prompt',
        },
      ],
    });
  });

  it('treats a missing or empty storage file as no sessions', async () => {
    const { filePath, repository } = await createRepository();

    await expect(repository.getSessionById(crypto.randomUUID())).resolves.toBeNull();

    await writeFile(filePath, '', 'utf8');

    await expect(repository.getSessionById(crypto.randomUUID())).resolves.toBeNull();
    expect(await readFile(filePath, 'utf8')).toBe('');
  });
});
