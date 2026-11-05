export const WALLET_ENVIRONMENTS = ['prd', 'stg', 'dev', 'loc'] as const;

export type WalletEnvironment = (typeof WALLET_ENVIRONMENTS)[number];

export function parseEnvironment(value: unknown): WalletEnvironment {
  if (typeof value === 'string' && (WALLET_ENVIRONMENTS as readonly string[]).includes(value)) {
    return value as WalletEnvironment;
  }
  throw new Error('ENVIRONMENT must be one of prd, stg, dev, or loc');
}

export type WalletRuntimeConfig = {
  environment: WalletEnvironment;
  databaseUrl: string;
  sessionSecret: string;
  port: number;
};

export function readWalletRuntimeConfig(env: NodeJS.ProcessEnv = process.env): WalletRuntimeConfig {
  const environment = parseEnvironment(env.ENVIRONMENT);
  const databaseUrl = env.DATABASE_URL;
  const sessionSecret = env.WALLET_SESSION_SECRET;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error('WALLET_SESSION_SECRET must contain at least 32 characters');
  }
  const parsedPort = env.PORT ? Number(env.PORT) : 3000;
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return { environment, databaseUrl, sessionSecret, port: parsedPort };
}

export function isKnownEnvironment(value: unknown): value is WalletEnvironment {
  return typeof value === 'string' && (WALLET_ENVIRONMENTS as readonly string[]).includes(value);
}

export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  parseEnvironment(config.ENVIRONMENT);
  if (typeof config.DATABASE_URL !== 'string' || config.DATABASE_URL.length === 0) {
    throw new Error('DATABASE_URL is required');
  }
  if (typeof config.WALLET_SESSION_SECRET !== 'string' || config.WALLET_SESSION_SECRET.length < 32) {
    throw new Error('WALLET_SESSION_SECRET must contain at least 32 characters');
  }
  return config;
}
