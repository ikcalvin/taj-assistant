# TAJ Assistant

TAJ Assistant is a Mastra-based AI assistant for answering general Tax Administration Jamaica (TAJ) questions using a retrieval-backed knowledge base. It is designed to stay grounded in uploaded TAJ documents instead of answering from model memory alone.

## What It Does

- Answers questions about tax services, TRN services, and motor vehicle services.
- Uses Pinecone-backed retrieval before responding.
- Exposes a chat API route through Mastra.
- Accepts Telegram bot webhooks and replies in Telegram chats.
- Stores local Mastra state in LibSQL and observability data in DuckDB for development.

## Project Layout

- `src/mastra/agents/taj-agent.ts`: Main TAJ assistant agent and its response rules.
- `src/mastra/tools/rag-tool.ts`: Knowledge-base search tool backed by Pinecone.
- `src/mastra/index.ts`: Mastra app registration, storage, logging, observability, and chat route.
- `src/mastra/server/telegram-webhook.ts`: Telegram webhook route that forwards messages to the TAJ assistant and sends replies back through the Telegram Bot API.
- `src/scripts/ingest.ts`: Script for chunking and ingesting TAJ source documents into Pinecone.

## Environment Variables

Copy `.env.example` to `.env` and provide the required values:

- `OPENAI_API_KEY`: Used by the TAJ assistant model.
- `PINECONE_API_KEY`: Used by the retrieval tool and ingestion script.
- `TURSO_DATABASE_URL`: Remote libSQL connection URL for production Mastra storage.
- `TURSO_AUTH_TOKEN`: Database token for the Turso database.
- `TELEGRAM_BOT_TOKEN`: Used to receive and reply to Telegram bot messages.
- `TELEGRAM_WEBHOOK_SECRET_TOKEN`: Optional shared secret used to verify Telegram webhook requests.
- `TELEGRAM_BOT_USERNAME`: Recommended for group-chat mention detection, without the leading `@`.
- `TELEGRAM_API_BASE_URL`: Optional override for the Telegram Bot API base URL.
- `INFISICAL_CLIENT_ID`: Machine identity client ID for Infisical Universal Auth.
- `INFISICAL_CLIENT_SECRET`: Machine identity client secret for Infisical Universal Auth.
- `INFISICAL_PROJECT_ID`: Infisical project ID containing this app's secrets.
- `INFISICAL_ENVIRONMENT`: Infisical environment slug to read from. Defaults to `prod`.
- `INFISICAL_SECRET_PATH`: Infisical folder path to read from. Defaults to `/`.
- `INFISICAL_SITE_URL`: Optional Infisical base URL. Defaults to `https://app.infisical.com`.
- `INFISICAL_RECURSIVE`: Whether to read nested folder secrets. Defaults to `true`.
- `INFISICAL_OVERRIDE_PROCESS_ENV`: When `true`, Infisical values overwrite existing process env values. Defaults to `false`.

If `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are not set, the app falls back to the existing local file-based development storage.

If `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`, and `INFISICAL_PROJECT_ID` are set, the app authenticates with Infisical at startup and loads secrets into `process.env` before the Mastra agent and tools initialize.

## Running Locally

Start Mastra Studio and the local API server:

```shell
npm run dev
```

Mastra Studio is available at [http://localhost:4111](http://localhost:4111).

If you are using Infisical, you can keep the application secrets in Infisical and only place the Infisical bootstrap variables in `.env`.

The chat API route is registered at:

```text
/chat/:agentId
```

Use `taj-assistant` as the agent id.

The Telegram webhook route is registered at:

```text
/telegram/webhook
```

To connect Telegram:

1. Create a bot with BotFather and copy its bot token.
2. Add the Telegram environment variables to `.env`.
3. Expose your local Mastra server with a tunnel such as `ngrok http 4111`.
4. Register the webhook with Telegram:

```shell
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-public-url/telegram/webhook",
    "secret_token": "your_random_webhook_secret"
  }'
```

In private chats, the bot responds to normal messages. In group chats, it responds when mentioned, when replied to, or when sent commands like `/ask`.

## Turso Setup

For production deployment, this project can use Turso for Mastra storage.

1. Install and log into the Turso CLI.
2. Create a database:

```shell
turso db create taj-assistant
```

3. Get the database URL:

```shell
turso db show taj-assistant
```

4. Create a database token:

```shell
turso db tokens create taj-assistant
```

5. Set these values in `.env`:

```text
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
```

When those env vars are present, Mastra uses Turso-backed `LibSQLStore` for production storage instead of the local `mastra.db` file.

## Infisical Setup

This project is wired for production-style Infisical access using a Machine Identity with Universal Auth and the official `@infisical/sdk`.

1. Create an Infisical project.
2. Add your application secrets to the appropriate environment and path.
3. Create a Machine Identity with read access to that environment and path.
4. Enable Universal Auth for that Machine Identity and copy the Client ID and Client Secret.
5. Add these bootstrap values to `.env`:

```text
INFISICAL_CLIENT_ID=...
INFISICAL_CLIENT_SECRET=...
INFISICAL_PROJECT_ID=...
INFISICAL_ENVIRONMENT=prod
INFISICAL_SECRET_PATH=/
```

6. Store your application secrets in Infisical under the selected environment and path using the same keys the app expects, for example:

```text
OPENAI_API_KEY
PINECONE_API_KEY
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET_TOKEN
TELEGRAM_BOT_USERNAME
```

At startup, the app logs into Infisical, fetches the secrets, and injects them into `process.env` before Mastra agents and tools are created.

## Ingesting Knowledge

Load source documents into Pinecone with:

```shell
npx tsx --env-file=.env src/scripts/ingest.ts ./path/to/documents
```

Supported file types:

- `.pdf`
- `.md`
- `.txt`

The ingestion script creates or reuses the `taj-knowledge` Pinecone index and stores chunk text with source metadata.

## Notes

- This assistant is intended for general guidance, not personalized tax advice.
- Retrieved content quality depends on the source documents you ingest.
- Generated local database files should stay out of git unless you intentionally want fixture data in the repo.
