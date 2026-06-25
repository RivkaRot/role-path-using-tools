import type {
  GeneratedAdaptiveAssessmentResponse,
  GeneratedQuestions,
  QuestionsResponse,
  RecommendationsRequest,
  RecommendationsResponse,
} from '../schemas/assessment.schemas.js';

export type AssessmentAiHistoryStep = 'questions' | 'recommendations';

export interface AssessmentAiHistoryEntry {
  step: AssessmentAiHistoryStep;
  requestPrompt: string;
  responsePayload:
    | GeneratedQuestions
    | GeneratedAdaptiveAssessmentResponse
    | RecommendationsResponse;
  createdAt: string;
}

export interface AssessmentQuestionRound {
  roundNumber: number;
  questions: QuestionsResponse['questions'];
  generatedAt: string;
}

export interface AssessmentAnswerRound {
  roundNumber: number;
  rawAnswers: RecommendationsRequest['answers'];
  resolvedAnswers: RecommendationsRequest['answers'];
  answeredAt: string;
}

export interface AssessmentSession {
  sessionId: string;
  currentRole: string;
  createdAt: string;
  updatedAt: string;
  questionRoundCount: number;
  activeQuestionRound: number;
  questions: QuestionsResponse['questions'];
  questionRounds: AssessmentQuestionRound[];
  answerHistory: AssessmentAnswerRound[];
  answers?: RecommendationsRequest['answers'];
  recommendations?: RecommendationsResponse;
  aiHistory: AssessmentAiHistoryEntry[];
}

export type AssessmentSessionUpdate = {
  updatedAt: string;
  questions?: AssessmentSession['questions'];
  activeQuestionRound?: number;
  questionRoundCount?: number;
  questionRounds?: AssessmentSession['questionRounds'];
  answers?: AssessmentSession['answers'];
  answerHistory?: AssessmentSession['answerHistory'];
  recommendations?: AssessmentSession['recommendations'];
  aiHistoryEntry?: AssessmentAiHistoryEntry;
};

export interface AssessmentSessionRepository {
  createSession(session: AssessmentSession): Promise<void>;
  getSessionById(sessionId: string): Promise<AssessmentSession | null>;
  updateSession(
    sessionId: string,
    update: AssessmentSessionUpdate,
  ): Promise<AssessmentSession | null>;
}
