import type { NextFunction, Request, Response } from 'express';
import { SessionNotFoundError } from '../errors/session-not-found.error.js';
import { recommendationsRequestSchema } from '../schemas/assessment.schemas.js';
import type { RecommendationsService } from '../services/recommendations.service.js';

export class RecommendationsController {
  public constructor(private readonly recommendationsService: RecommendationsService) {}

  public handle = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    
    const parsed = recommendationsRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
      return;
    }

    try {
      response.json(await this.recommendationsService.generate(parsed.data));
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        response.status(404).json({ error: error.message });
        return;
      }

      next(error);
    }
  };
}
