import express, { type ErrorRequestHandler, type Express } from 'express';
import { FileAssessmentSessionRepository } from './repositories/file-assessment-session.repository.js';
import type { ChatCompletionClient } from './clients/openai-chat.client.js';
import { QuestionsController } from './controllers/questions.controller.js';
import { RecommendationsController } from './controllers/recommendations.controller.js';
import { createAssessmentRouter } from './routes/assessment.routes.js';
import { QuestionsService } from './services/questions.service.js';
import { RecommendationsService } from './services/recommendations.service.js';

export class AppFactory {
  public static create(
    chatClient: ChatCompletionClient,
    sessionsFilePath: string,
    corsOrigin = 'http://localhost:5173',
  ): Express {
    const app = express();
    const sessionRepository = new FileAssessmentSessionRepository(sessionsFilePath);
    const questionsController = new QuestionsController(
      new QuestionsService(chatClient, sessionRepository),
    );
    const recommendationsController = new RecommendationsController(
      new RecommendationsService(chatClient, sessionRepository),
    );

    app.use((request, response, next) => {
      response.header('Access-Control-Allow-Origin', corsOrigin);
      response.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      response.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (request.method === 'OPTIONS') {
        return response.sendStatus(204);
      }

      next();
    });
    app.use(express.json());
    app.use('/api/v1', createAssessmentRouter(questionsController, recommendationsController));
    const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
      void next;
      console.error(error);
      const message = error instanceof Error ? error.message : 'Internal server error';
      response.status(500).json({ error: message });
    };
    app.use(errorHandler);
    return app;
  }
}
