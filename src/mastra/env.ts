import { InfisicalSDK } from '@infisical/sdk';

type InfisicalBootstrapConfig = {
  clientId: string;
  clientSecret: string;
  projectId: string;
  environment: string;
  secretPath: string;
  recursive: boolean;
  siteUrl?: string;
  overrideProcessEnv: boolean;
};

const INFISICAL_BOOTSTRAP_KEYS = [
  'INFISICAL_CLIENT_ID',
  'INFISICAL_CLIENT_SECRET',
  'INFISICAL_PROJECT_ID',
] as const;

let infisicalBootstrapPromise: Promise<void> | null = null;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalizedValue)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalizedValue)) {
    return false;
  }

  return fallback;
}

function getInfisicalBootstrapConfig(): InfisicalBootstrapConfig | null {
  const clientId = process.env.INFISICAL_CLIENT_ID?.trim();
  const clientSecret = process.env.INFISICAL_CLIENT_SECRET?.trim();
  const projectId = process.env.INFISICAL_PROJECT_ID?.trim();

  const configuredCount = [clientId, clientSecret, projectId].filter(Boolean)
    .length;

  if (configuredCount === 0) {
    return null;
  }

  if (configuredCount !== INFISICAL_BOOTSTRAP_KEYS.length) {
    throw new Error(
      `Incomplete Infisical configuration. Set ${INFISICAL_BOOTSTRAP_KEYS.join(', ')} together.`,
    );
  }

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    projectId: projectId!,
    environment: process.env.INFISICAL_ENVIRONMENT?.trim() || 'prod',
    secretPath: process.env.INFISICAL_SECRET_PATH?.trim() || '/',
    recursive: parseBoolean(process.env.INFISICAL_RECURSIVE, true),
    siteUrl: process.env.INFISICAL_SITE_URL?.trim() || undefined,
    overrideProcessEnv: parseBoolean(
      process.env.INFISICAL_OVERRIDE_PROCESS_ENV,
      false,
    ),
  };
}

async function bootstrapInfisicalSecrets(
  config: InfisicalBootstrapConfig,
): Promise<void> {
  const client = new InfisicalSDK({
    siteUrl: config.siteUrl,
  });

  await client.auth().universalAuth.login({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  const secrets = await client.secrets().listSecretsWithImports({
    environment: config.environment,
    projectId: config.projectId,
    secretPath: config.secretPath,
    recursive: config.recursive,
    expandSecretReferences: true,
    viewSecretValue: true,
  });

  for (const secret of secrets) {
    if (
      !config.overrideProcessEnv &&
      process.env[secret.secretKey] !== undefined
    ) {
      continue;
    }

    process.env[secret.secretKey] = secret.secretValue;
  }
}

export async function loadInfisicalEnvironment(): Promise<void> {
  if (!infisicalBootstrapPromise) {
    const config = getInfisicalBootstrapConfig();

    infisicalBootstrapPromise = config
      ? bootstrapInfisicalSecrets(config)
      : Promise.resolve();
  }

  await infisicalBootstrapPromise;
}

export function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}
