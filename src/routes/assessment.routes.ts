import { Router } from 'express';
import type { QuestionsController } from '../controllers/questions.controller.js';
import type { RecommendationsController } from '../controllers/recommendations.controller.js';

export function createAssessmentRouter(
  questionsController: QuestionsController,
  recommendationsController: RecommendationsController,
): Router {
  const router = Router();
  router.post('/questions', questionsController.handle);
  router.post('/recommendations', recommendationsController.handle);
  return router;
}
