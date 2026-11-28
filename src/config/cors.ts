import type { INestApplication } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { WalletEnvironment } from './environment';

export const CORS_ORIGINS: Readonly<Record<Exclude<WalletEnvironment, 'loc'>, readonly string[]>> = Object.freeze({
  prd: ['https://app.dfx.swiss'],
  stg: ['https://stg.app.dfx.swiss'],
  dev: ['https://dev.app.dfx.swiss'],
});

export const LOCAL_CORS_ORIGIN = 'http://localhost:3000';

export const CORS_METHODS = ['GET', 'POST', 'PUT'];
export const CORS_ALLOWED_HEADERS = ['Authorization', 'Content-Type'];
export const CORS_MAX_AGE_SECONDS = 600;

/** A bare `http:` or `https:` origin such as `http://wallet.localhost:3000`, without path, credentials, or query. */
function bareOrigin(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      return undefined;
    }
    return url.origin === value ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The browser origins allowed to call this API: the environment's app origin only. `loc` allows
 * `http://localhost:3000` and the configured `PASSKEY_ORIGIN` when it is a bare origin.
 */
export function corsOrigins(environment: WalletEnvironment, passkeyOrigin?: string): string[] {
  if (environment !== 'loc') {
    return [...CORS_ORIGINS[environment]];
  }
  const origins = [LOCAL_CORS_ORIGIN];
  const configured = bareOrigin(passkeyOrigin);
  if (configured && !origins.includes(configured)) {
    origins.push(configured);
  }
  return origins;
}

/**
 * Exact-match origin list. A request from any other origin gets no `Access-Control-Allow-Origin` header, so the
 * browser refuses the response. No credentials: the wallet session travels in the `Authorization` header.
 */
export function corsOptions(environment: WalletEnvironment, passkeyOrigin?: string): CorsOptions {
  return {
    origin: corsOrigins(environment, passkeyOrigin),
    methods: CORS_METHODS,
    allowedHeaders: CORS_ALLOWED_HEADERS,
    credentials: false,
    maxAge: CORS_MAX_AGE_SECONDS,
    optionsSuccessStatus: 204,
  };
}

export function configureCors(app: INestApplication, environment: WalletEnvironment, passkeyOrigin?: string): void {
  app.enableCors(corsOptions(environment, passkeyOrigin));
}
