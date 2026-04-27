# TAJ Assistant

TAJ Assistant is a Mastra-based AI assistant for answering general Tax Administration Jamaica (TAJ) questions using a retrieval-backed knowledge base. It is designed to stay grounded in uploaded TAJ documents instead of answering from model memory alone.

## What It Does

- Answers questions about tax services, TRN services, and motor vehicle services.
- Uses Pinecone-backed retrieval before responding.
- Exposes a chat API route through Mastra.
- Stores local Mastra state in LibSQL and observability data in DuckDB for development.

## Project Layout

- `src/mastra/agents/taj-agent.ts`: Main TAJ assistant agent and its response rules.
- `src/mastra/tools/rag-tool.ts`: Knowledge-base search tool backed by Pinecone.
- `src/mastra/index.ts`: Mastra app registration, storage, logging, observability, and chat route.
- `src/scripts/ingest.ts`: Script for chunking and ingesting TAJ source documents into Pinecone.

## Environment Variables

Copy `.env.example` to `.env` and provide the required values:

- `OPENAI_API_KEY`: Used by the TAJ assistant model.
- `PINECONE_API_KEY`: Used by the retrieval tool and ingestion script.

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
