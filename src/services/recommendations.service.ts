import type {
  ChatCompletionClient,
  ToolExecutionAudit,
  ToolResponseValidationResult,
} from '../clients/openai-chat.client.js';
import { SessionNotFoundError } from '../errors/session-not-found.error.js';
import {
  createAdaptiveAssessmentPrompt,
  createRecommendationsPrompt,
} from '../prompts/recommendations.prompt.js';
import type {
  AssessmentAnswerRound,
  AssessmentSession,
  AssessmentSessionRepository,
} from '../repositories/assessment-session.repository.js';
import {
  generatedAdaptiveAssessmentResponseSchema,
  generatedRecommendationsResponseSchema,
  type AdaptiveRecommendationsResponse,
  type RecommendationsRequest,
  type RecommendationsResponse,
} from '../schemas/assessment.schemas.js';
import { loadAdaptiveAssessmentSkill } from '../skills/adaptive-assessment-skill.loader.js';
const MAX_QUESTION_ROUNDS = 3;

export class RecommendationsService {
  public constructor(
    private readonly chatClient: ChatCompletionClient,
    private readonly sessionRepository: AssessmentSessionRepository,
  ) {}

  public async generate(
    input: RecommendationsRequest,
  ): Promise<AdaptiveRecommendationsResponse> {
    const session = await this.sessionRepository.getSessionById(input.sessionId);
    if (!session) {
      throw new SessionNotFoundError(input.sessionId);
    }

    const resolvedAnswers = this.resolveAnswers(session, input.answers);
    const answeredAt = new Date().toISOString();
    const answerRound: AssessmentAnswerRound = {
      roundNumber: session.activeQuestionRound,
      rawAnswers: input.answers,
      resolvedAnswers,
      answeredAt,
    };
    const answerHistory = [...session.answerHistory, answerRound];
    const skillText = await loadAdaptiveAssessmentSkill();

    if (session.questionRoundCount >= MAX_QUESTION_ROUNDS) {
      return this.generateFinalRecommendations(
        session,
        input.answers,
        resolvedAnswers,
        answerHistory,
        answeredAt,
        skillText,
      );
    }
    const prompt = createAdaptiveAssessmentPrompt({
      currentRole: session.currentRole,
      questionRounds: session.questionRounds,
      answerHistory: session.answerHistory,
      currentAnswers: resolvedAnswers,
    });
    const decision = await this.chatClient.createStructuredCompletionWithTools(
      prompt,
      'generated_adaptive_assessment_response',
      generatedAdaptiveAssessmentResponseSchema,
      {
        systemPromptAppendix: skillText,
        validateParsedResponse: validateRecommendationToolUsage,
      },
    );

    if (decision.result.type === 'questions') {
      const nextRoundNumber = session.questionRoundCount + 1;
      const updatedAt = new Date().toISOString();

      await this.sessionRepository.updateSession(input.sessionId, {
        updatedAt,
        questions: decision.result.questions,
        activeQuestionRound: nextRoundNumber,
        questionRoundCount: nextRoundNumber,
        questionRounds: [
          ...session.questionRounds,
          {
            roundNumber: nextRoundNumber,
            questions: decision.result.questions,
            generatedAt: updatedAt,
          },
        ],
        answers: input.answers,
        answerHistory,
        aiHistoryEntry: {
          step: 'questions',
          requestPrompt: prompt,
          responsePayload: decision,
          createdAt: updatedAt,
        },
      });

      return {
        type: 'questions',
        sessionId: input.sessionId,
        questions: decision.result.questions,
      };
    }

    return this.finalizeRecommendations(
      session,
      decision.result,
      input,
      answerHistory,
      answeredAt,
      prompt,
    );
  }

  private async generateFinalRecommendations(
    session: AssessmentSession,
    rawAnswers: RecommendationsRequest['answers'],
    resolvedAnswers: RecommendationsRequest['answers'],
    answerHistory: AssessmentAnswerRound[],
    answeredAt: string,
    skillText: string,
  ): Promise<RecommendationsResponse> {
    const prompt = createRecommendationsPrompt({
      currentRole: session.currentRole,
      questionRounds: session.questionRounds,
      answerHistory: session.answerHistory,
      currentAnswers: resolvedAnswers,
    });

    const recommendations = await this.chatClient.createStructuredCompletionWithTools(
      prompt,
      'generated_recommendations_response',
      generatedRecommendationsResponseSchema,
      {
        systemPromptAppendix: skillText,
        validateParsedResponse: validateRecommendationToolUsage,
      },
    );

    return this.finalizeRecommendations(
      session,
      recommendations,
      { sessionId: session.sessionId, answers: rawAnswers },
      answerHistory,
      answeredAt,
      prompt,
    );
  }

  private async finalizeRecommendations(
    session: AssessmentSession,
    recommendations:
      | {
        type: 'recommendations';
        topics: RecommendationsResponse['topics'];
        calendarEvents: RecommendationsResponse['calendarEvents'];
      }
      | {
        topics: RecommendationsResponse['topics'];
        calendarEvents: RecommendationsResponse['calendarEvents'];
      },
    input: Pick<RecommendationsRequest, 'sessionId' | 'answers'>,
    answerHistory: AssessmentAnswerRound[],
    answeredAt: string,
    prompt: string,
  ): Promise<RecommendationsResponse> {
    const enrichedRecommendations: RecommendationsResponse = {
      ...recommendations,
      type: 'recommendations',
    };

    await this.sessionRepository.updateSession(input.sessionId, {
      updatedAt: answeredAt,
      answers: input.answers,
      answerHistory,
      recommendations: enrichedRecommendations,
      aiHistoryEntry: {
        step: 'recommendations',
        requestPrompt: prompt,
        responsePayload: enrichedRecommendations,
        createdAt: answeredAt,
      },
    });

    return enrichedRecommendations;
  }

  private resolveAnswers(
    session: AssessmentSession,
    answers: RecommendationsRequest['answers'],
  ): RecommendationsRequest['answers'] {
    return answers.map((answer) => {
      const matchedQuestion = session.questions.find((question) => question.id === answer.question);
      if (!matchedQuestion) {
        return answer;
      }

      const matchedOption = matchedQuestion.options.find(
        (option) => option.id === answer.selectedAnswer,
      );

      return {
        question: matchedQuestion.text,
        selectedAnswer: matchedOption?.label ?? answer.selectedAnswer,
      };
    });
  }
}

const CALENDAR_TOOL_NAME = 'create_calendar_event';

function validateRecommendationToolUsage(
  parsed: unknown,
  audit: ToolExecutionAudit,
): ToolResponseValidationResult {
  const recommendations = extractRecommendationsPayload(parsed);
  if (!recommendations) {
    return { ok: true };
  }

  const successfulCalendarCalls = audit.records.filter(
    (record) => record.toolName === CALENDAR_TOOL_NAME && record.succeeded,
  );

  if (successfulCalendarCalls.length !== recommendations.calendarEvents.length) {
    return invalidRecommendationToolUsageResult(
      `OpenAI returned recommendations without exactly ${recommendations.calendarEvents.length} successful ${CALENDAR_TOOL_NAME} calls.`,
    );
  }

  const unmatchedCalls = [...successfulCalendarCalls];
  for (const calendarEvent of recommendations.calendarEvents) {
    const matchedCallIndex = unmatchedCalls.findIndex((record) =>
      matchesCalendarEvent(record, calendarEvent),
    );

    if (matchedCallIndex === -1) {
      return invalidRecommendationToolUsageResult(
        `OpenAI returned recommendations with calendar event fields that do not match the ${CALENDAR_TOOL_NAME} tool responses.`,
      );
    }

    unmatchedCalls.splice(matchedCallIndex, 1);
  }

  return { ok: true };
}

function invalidRecommendationToolUsageResult(errorMessage: string): ToolResponseValidationResult {
  return {
    ok: false,
    errorMessage,
    retryMessage:
      `Your previous response was invalid because you returned recommendations without the required ${CALENDAR_TOOL_NAME} tool usage. `
      + `Call ${CALENDAR_TOOL_NAME} exactly once per topic, copy eventId and calendarLink only from the tool responses, `
      + 'and then return the final JSON.',
  };
}

function extractRecommendationsPayload(parsed: unknown):
  | {
    calendarEvents: RecommendationsResponse['calendarEvents'];
  }
  | null {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  if ('type' in parsed && parsed.type === 'recommendations' && 'calendarEvents' in parsed) {
    return parsed as { calendarEvents: RecommendationsResponse['calendarEvents'] };
  }

  if (
    'result' in parsed
    && parsed.result
    && typeof parsed.result === 'object'
    && 'type' in parsed.result
    && parsed.result.type === 'recommendations'
    && 'calendarEvents' in parsed.result
  ) {
    return parsed.result as { calendarEvents: RecommendationsResponse['calendarEvents'] };
  }

  return null;
}

function matchesCalendarEvent(
  record: ToolExecutionAudit['records'][number],
  calendarEvent: RecommendationsResponse['calendarEvents'][number],
): boolean {
  const args = record.args as {
    title?: string;
    startDateTime?: string;
    endDateTime?: string;
  };
  const result = record.result as {
    id?: string;
    htmlLink?: string | null;
  };

  return (
    args.title === calendarEvent.title
    && args.startDateTime === calendarEvent.startDateTime
    && args.endDateTime === calendarEvent.endDateTime
    && result.id === calendarEvent.eventId
    && (result.htmlLink ?? null) === calendarEvent.calendarLink
  );
}
