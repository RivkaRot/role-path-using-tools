import type { ChatCompletionClient } from '../clients/openai-chat.client.js';
import { createQuestionsPrompt } from '../prompts/questions.prompt.js';
import type { AssessmentSessionRepository } from '../repositories/assessment-session.repository.js';
import { randomUUID } from 'node:crypto';
import {
  generatedQuestionsSchema,
  type QuestionsResponse,
} from '../schemas/assessment.schemas.js';

export class QuestionsService {
  public constructor(
    private readonly chatClient: ChatCompletionClient,
    private readonly sessionRepository: AssessmentSessionRepository,
  ) {}

  public async generate(currentRole: string): Promise<QuestionsResponse> {
    const prompt = createQuestionsPrompt(currentRole);
    const questions = await this.chatClient.createStructuredCompletion(
      prompt,
      'questions_response',
      generatedQuestionsSchema,
    );
    const now = new Date().toISOString();
    const sessionId = randomUUID();

    await this.sessionRepository.createSession({
      sessionId,
      currentRole,
      createdAt: now,
      updatedAt: now,
      questionRoundCount: 1,
      activeQuestionRound: 1,
      questions: questions.questions,
      questionRounds: [
        {
          roundNumber: 1,
          questions: questions.questions,
          generatedAt: now,
        },
      ],
      answerHistory: [],
      aiHistory: [
        {
          step: 'questions',
          requestPrompt: prompt,
          responsePayload: questions,
          createdAt: now,
        },
      ],
    });

    return {
      type: 'questions',
      sessionId,
      questions: questions.questions,
    };
  }
}
