# TAJ Assistant

TAJ Assistant is a Mastra-based AI assistant for answering general Tax Administration Jamaica (TAJ) questions using a retrieval-backed knowledge base. It is designed to stay grounded in uploaded TAJ documents instead of answering from model memory alone.

## What It Does

- Answers questions about tax services, TRN services, and motor vehicle services.
- Routes questions to specialist agents via an orchestrator for more focused, accurate responses.
- Uses namespaced Pinecone-backed retrieval (tax, TRN, motor vehicle) before responding.
- Falls back to web search when knowledge base confidence is low.
- Remembers conversation context across messages per user.
- Exposes a chat API route through Mastra.
- Accepts Telegram bot webhooks and replies in Telegram chats.
- Stores local Mastra state in LibSQL and observability data in DuckDB for development.

## Architecture

```
Telegram user
     |
     v
Orchestrator agent  (classifies intent, remembers conversation context)
     |
     |-->  Tax agent          -->  Pinecone [namespace: tax]
     |-->  TRN agent          -->  Pinecone [namespace: trn]
     |-->  Motor vehicle agent -->  Pinecone [namespace: motor-vehicle]
                                        |
                                        |-- score < 0.75?
                                                |
                                                v
                                        Web search (Tavily)
```

The orchestrator classifies each incoming message and delegates to the appropriate specialist agent. Each specialist queries only its own Pinecone namespace, reducing cross-domain retrieval noise. When retrieval confidence is low (topScore < 0.75), the specialist falls back to a Tavily-powered web search.

The orchestrator has memory enabled, so it retains conversation context across messages for each user and chat thread.

## Project Layout

- `src/mastra/agents/orchestrator-agent.ts`: Orchestrator that classifies intent and routes to specialist agents. Has memory for multi-turn conversations.
- `src/mastra/agents/tax-agent.ts`: Specialist for GCT, income tax, payroll, property tax, and withholding tax.
- `src/mastra/agents/trn-agent.ts`: Specialist for TRN registration, TCC applications, and FATCA.
- `src/mastra/agents/motor-vehicle-agent.ts`: Specialist for eMVRC renewal, driver's licence, and fitness certificate.
- `src/mastra/agents/taj-agent.ts`: General-purpose TAJ assistant (legacy fallback).
- `src/mastra/tools/rag-tool.ts`: Knowledge-base search tool backed by Pinecone with namespace support and score reporting.
- `src/mastra/tools/web-search-tool.ts`: Tavily-powered web search fallback for low-confidence RAG results.
- `src/mastra/index.ts`: Mastra app registration, storage, logging, observability, and routes.
- `src/mastra/server/telegram-webhook.ts`: Telegram webhook route that forwards messages to the orchestrator and sends replies back through the Telegram Bot API.
- `src/scripts/ingest.ts`: Script for chunking and ingesting TAJ source documents into namespaced Pinecone indexes.
- `docs/tax/`: Source documents for tax-related topics.
- `docs/trn/`: Source documents for TRN and registration topics.
- `docs/motor-vehicle/`: Source documents for motor vehicle services.

## Environment Variables

Copy `.env.example` to `.env` and provide the required values:

- `OPENAI_API_KEY`: Used by the agent models.
- `PINECONE_API_KEY`: Used by the retrieval tools and ingestion script.
- `TURSO_DATABASE_URL`: Remote libSQL connection URL for production Mastra storage.
- `TURSO_AUTH_TOKEN`: Database token for the Turso database.
- `TELEGRAM_BOT_TOKEN`: Used to receive and reply to Telegram bot messages.
- `TELEGRAM_WEBHOOK_SECRET_TOKEN`: Optional shared secret used to verify Telegram webhook requests.
- `TELEGRAM_BOT_USERNAME`: Recommended for group-chat mention detection, without the leading `@`.
- `TELEGRAM_API_BASE_URL`: Optional override for the Telegram Bot API base URL.
- `SEARCH_API_KEY`: Tavily API key for web search fallback.
- `MASTRA_CLOUD_ACCESS_TOKEN`: Optional token for Mastra Cloud observability export. Leave unset for local-only observability.
- `MASTRA_OBSERVABILITY_LOGS_ENABLED`: Optional (`true`/`false`). Defaults to `false` in this project to avoid unsupported batch log-write warnings on some storage providers.

If `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are not set, the app falls back to the existing local file-based development storage.

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

Available agent IDs: `orchestrator`, `tax-agent`, `trn-agent`, `motor-vehicle-agent`, `taj-assistant`.

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

## Pinecone Setup

The project uses a single Pinecone index (`taj-knowledge`) with three namespaces for domain separation. No manual index creation is needed — the ingestion script handles it.

1. Sign up at [pinecone.io](https://pinecone.io) and get your API key.
2. Add it to `.env`:

```text
PINECONE_API_KEY=your_pinecone_api_key
```

The index uses Pinecone's integrated inference with the `llama-text-embed-v2` model, so embeddings are generated server-side during ingestion and search. No separate embedding API key is needed.

## Ingesting Knowledge

Load source documents into namespaced Pinecone indexes:

```shell
npx tsx --env-file=.env src/scripts/ingest.ts ./docs/tax --namespace tax
npx tsx --env-file=.env src/scripts/ingest.ts ./docs/trn --namespace trn
npx tsx --env-file=.env src/scripts/ingest.ts ./docs/motor-vehicle --namespace motor-vehicle
```

Supported file types:

- `.pdf`
- `.md`
- `.txt`

Each chunk is prefixed with the document title and nearest section heading for better retrieval context. Source, section, and page metadata are stored alongside each vector.

## Web Search Fallback

When a specialist agent's RAG retrieval returns a top score below 0.75, it automatically falls back to a Tavily-powered web search. To enable this:

1. Sign up at [tavily.com](https://tavily.com) and get your API key.
2. Add it to `.env`:

```text
SEARCH_API_KEY=your_tavily_api_key
```

If `SEARCH_API_KEY` is not set, the web search fallback is silently disabled and the agents rely solely on the knowledge base.

## Automated Re-Ingestion

A GitHub Actions workflow (`.github/workflows/reingest.yml`) runs weekly to scrape the TAJ website and re-ingest documents into Pinecone. It can also be triggered manually via workflow_dispatch.

Required repository secrets:

- `OPENAI_API_KEY`
- `PINECONE_API_KEY`
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`

## Notes

- This assistant is intended for general guidance, not personalized tax advice.
- Retrieved content quality depends on the source documents you ingest.
- Generated local database files should stay out of git unless you intentionally want fixture data in the repo.
