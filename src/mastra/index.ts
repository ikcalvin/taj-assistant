
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
      origin: ['http://localhost:3000'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
    },
    apiRoutes: [
      chatRoute({ path: '/chat/:agentId' }),
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
              new DefaultExporter(), // Persists traces to storage for Mastra Studio
              new CloudExporter({ accessToken: mastraCloudAccessToken }), // Sends observability data to hosted Mastra Studio
            ]
          : [
              new DefaultExporter(), // Persists traces to storage for Mastra Studio
            ],
        logging: {
          enabled: shouldForwardLogsToObservability, // Some stores do not support log batch writes
        },
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
});
