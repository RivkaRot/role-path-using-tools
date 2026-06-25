export class SessionNotFoundError extends Error {
  public constructor(sessionId: string) {
    super(`Assessment session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
  }
}
