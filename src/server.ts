import 'dotenv/config';
import { AppFactory } from './app.js';
import { OpenAIChatClient } from './clients/openai-chat.client.js';
import { loadConfig } from './config/env.js';

const config = loadConfig();

const app = AppFactory.create(
  new OpenAIChatClient(config.OPENAI_API_KEY, config.OPENAI_MODEL),
  config.SESSIONS_FILE_PATH,
  config.CORS_ORIGIN,
);

app.listen(config.PORT, () => {
  process.stdout.write(`Server listening on port ${config.PORT}\n`);
});
