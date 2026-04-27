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
- `TELEGRAM_BOT_TOKEN`: Used to receive and reply to Telegram bot messages.
- `TELEGRAM_WEBHOOK_SECRET_TOKEN`: Optional shared secret used to verify Telegram webhook requests.
- `TELEGRAM_BOT_USERNAME`: Recommended for group-chat mention detection, without the leading `@`.
- `TELEGRAM_API_BASE_URL`: Optional override for the Telegram Bot API base URL.

## Running Locally

Start Mastra Studio and the local API server:

```shell
npm run dev
```

Mastra Studio is available at [http://localhost:4111](http://localhost:4111).

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
