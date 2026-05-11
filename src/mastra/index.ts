import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { MastraCompositeStore } from '@mastra/core/storage';
import { Observability, DefaultExporter, CloudExporter, SensitiveDataFilter } from '@mastra/observability';
import { chatRoute } from '@mastra/ai-sdk';
import { orchestratorAgent } from './agents/orchestrator-agent';
import { taxAgent } from './agents/tax-agent';
import { trnAgent } from './agents/trn-agent';
import { motorVehicleAgent } from './agents/motor-vehicle-agent';
import { telegramWebhookRoute } from './server/telegram-webhook';

const tursoDatabaseUrl = process.env.TURSO_DATABASE_URL?.trim();
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN?.trim();
const isTursoConfigured = Boolean(tursoDatabaseUrl && tursoAuthToken);
const mastraCloudAccessToken = process.env.MASTRA_CLOUD_ACCESS_TOKEN?.trim();
const isCloudExporterEnabled = Boolean(mastraCloudAccessToken);
const shouldForwardLogsToObservability = process.env.MASTRA_OBSERVABILITY_LOGS_ENABLED?.trim() === 'true';

// ---------------------------------------------------------------------------
// CORS — configurable allowed origins
// ---------------------------------------------------------------------------
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000'];

// ---------------------------------------------------------------------------
// Auth — API key protection for chat endpoints
// ---------------------------------------------------------------------------
const mastraApiKey = process.env.MASTRA_API_KEY?.trim();

// Build server auth config when an API key is set
function buildAuthMiddleware() {
  if (!mastraApiKey) {
    console.warn(
      '[security] MASTRA_API_KEY is not set — chat endpoints are UNPROTECTED. Set MASTRA_API_KEY in .env for production.',
    );
    return [];
  }

  return [
    {
      path: '/chat/*' as const,
      handler: async (c: any, next: () => Promise<void>) => {
        const authHeader = c.req.header('authorization');
        if (!authHeader || authHeader !== `Bearer ${mastraApiKey}`) {
          return c.json({ error: 'Unauthorized' }, 401);
        }
        await next();
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
const mastraStorage = isTursoConfigured
  ? new LibSQLStore({
      id: 'mastra-storage',
      url: tursoDatabaseUrl!,
      authToken: tursoAuthToken!,
    })
  : new MastraCompositeStore({
      id: 'composite-storage',
      default: new LibSQLStore({
        id: 'mastra-storage',
        url: 'file:./mastra.db',
      }),
      domains: {
        observability: await new (await import('@mastra/duckdb')).DuckDBStore().getStore('observability'),
      },
    });

// ---------------------------------------------------------------------------
// Mastra instance
// ---------------------------------------------------------------------------
export const mastra = new Mastra({
  workflows: {},
  agents: {
    orchestratorAgent,
    taxAgent,
    trnAgent,
    motorVehicleAgent,
  },
  scorers: {},
  server: {
    cors: {
      origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
      credentials: true,
    },
    middleware: buildAuthMiddleware(),
    apiRoutes: [
      chatRoute({ path: '/chat/:agentId', version: 'v6' }),
      telegramWebhookRoute,
    ],
  },
  storage: mastraStorage,
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: isCloudExporterEnabled
          ? [
              new DefaultExporter(),
              new CloudExporter({ accessToken: mastraCloudAccessToken }),
            ]
          : [
              new DefaultExporter(),
            ],
        logging: {
          enabled: shouldForwardLogsToObservability,
        },
        spanOutputProcessors: [
          new SensitiveDataFilter(),
        ],
      },
    },
  }),
});
