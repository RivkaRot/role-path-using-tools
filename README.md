# Programming Gap Server

Express API that uses OpenAI to generate programming-role assessment questions and learning recommendations with file-backed assessment sessions.

## Setup

```bash
npm install
copy .env.example .env
npm run dev
```

Set `OPENAI_API_KEY`, `OPENAI_MODEL`, `PORT`, and optionally `SESSIONS_FILE_PATH` in `.env`.
Recommendations use a local tool-calling loop for link discovery, with up to 5 tool rounds before forcing a final answer.
Use Node.js 20.19 or newer.

## Endpoints

- `POST /api/v1/questions` with `{ "currentRole": "Frontend Developer" }`
  returns `{ "sessionId": "...", "questions": [...] }`
- `POST /api/v1/recommendations` with `{ "sessionId": "...", "answers": [...] }`
  where `answers` contains exactly five `{ question, selectedAnswer }` entries

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```
