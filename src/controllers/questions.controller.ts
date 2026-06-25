import type { NextFunction, Request, Response } from 'express';
import { questionsRequestSchema } from '../schemas/assessment.schemas.js';
import type { QuestionsService } from '../services/questions.service.js';

export class QuestionsController {
  public constructor(private readonly questionsService: QuestionsService) {}

  public handle = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const parsed = questionsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
      return;
    }

    try {
      response.json(await this.questionsService.generate(parsed.data.currentRole));
    } catch (error) {
      next(error);
    }
  };
}
