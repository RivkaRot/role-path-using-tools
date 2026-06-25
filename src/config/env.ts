import { resolve } from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),
  WEB_SEARCH_PROVIDER: z.enum(['none', 'bing']).default('none'),
  WEB_SEARCH_API_KEY: z.string().min(1).optional(),
  WEB_SEARCH_API_ENDPOINT: z.string().url().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SESSIONS_FILE_PATH: z.string().min(1).default(resolve(process.cwd(), 'data', 'assessment-sessions.json')),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
  TAVILY_API_KEY: z.string().min(1)
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(environment);
}
