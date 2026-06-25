import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  type AssessmentSession,
  type AssessmentSessionRepository,
} from './assessment-session.repository.js';

export class FileAssessmentSessionRepository implements AssessmentSessionRepository {
  public constructor(private readonly filePath: string) {}

  public async createSession(session: AssessmentSession): Promise<void> {
    const sessions = await this.readSessions();
    sessions.push(session);
    await this.writeSessions(sessions);
  }

  public async getSessionById(sessionId: string): Promise<AssessmentSession | null> {
    const sessions = await this.readSessions();
    return sessions.find((session) => session.sessionId === sessionId) ?? null;
  }

  public async updateSession(
    sessionId: string,
    update: Partial<Omit<AssessmentSession, 'sessionId' | 'currentRole' | 'createdAt' | 'aiHistory'>>
    & {
      updatedAt: string;
      aiHistoryEntry?: AssessmentSession['aiHistory'][number];
    },
  ): Promise<AssessmentSession | null> {
    const sessions = await this.readSessions();
    const session = sessions.find((entry) => entry.sessionId === sessionId);

    if (!session) {
      return null;
    }

    if (update.questions) {
      session.questions = update.questions;
    }
    if (update.activeQuestionRound !== undefined) {
      session.activeQuestionRound = update.activeQuestionRound;
    }
    if (update.questionRoundCount !== undefined) {
      session.questionRoundCount = update.questionRoundCount;
    }
    if (update.questionRounds) {
      session.questionRounds = update.questionRounds;
    }
    if (update.answers) {
      session.answers = update.answers;
    }
    if (update.answerHistory) {
      session.answerHistory = update.answerHistory;
    }
    if (update.recommendations) {
      session.recommendations = update.recommendations;
    }
    session.updatedAt = update.updatedAt;
    if (update.aiHistoryEntry) {
      session.aiHistory.push(update.aiHistoryEntry);
    }

    await this.writeSessions(sessions);
    return session;
  }

  private async readSessions(): Promise<AssessmentSession[]> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      if (!content.trim()) {
        return [];
      }

      return JSON.parse(content) as AssessmentSession[];
    } catch (error) {
      if (this.isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  }

  private async writeSessions(sessions: AssessmentSession[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempFilePath = `${this.filePath}.tmp`;
    await writeFile(tempFilePath, JSON.stringify(sessions, null, 2), 'utf8');
    await rename(tempFilePath, this.filePath);
  }

  private isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
  }
}
