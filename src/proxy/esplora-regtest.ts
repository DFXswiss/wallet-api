export const ESPLORA_REGTEST_BLOCKCHAIN = 'BitcoinRegtest';

export const ESPLORA_REGTEST_ENVIRONMENTS: readonly string[] = ['stg', 'dev', 'loc'];

function isSet(raw: unknown): boolean {
  return raw !== undefined && raw !== null && raw !== '';
}

/**
 * Parses `ESPLORA_REGTEST_URL`. Returns the origin without a trailing slash, `undefined` when the
 * variable is unset or empty, and throws when the value is not a bare `http:` or `https:` origin.
 * The error never echoes the value, because a rejected value may carry credentials.
 */
export function parseEsploraRegtestOrigin(raw: unknown): string | undefined {
  if (!isSet(raw)) {
    return undefined;
  }
  const invalid = new Error(
    'ESPLORA_REGTEST_URL must be an http or https origin without credentials, path, query, or fragment',
  );
  if (typeof raw !== 'string') {
    throw invalid;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid;
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.origin !== raw.replace(/\/$/, '') ||
    url.toString() !== `${url.origin}/`
  ) {
    throw invalid;
  }
  return url.origin;
}

/** True when the raw `ESPLORA_BASE_URLS` JSON names `BitcoinRegtest`, a configuration boot refuses. */
export function hasRegtestKey(rawBaseUrls: unknown): boolean {
  if (typeof rawBaseUrls !== 'string' || !rawBaseUrls) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBaseUrls);
  } catch {
    return false;
  }
  return (
    Boolean(parsed) &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    Object.hasOwn(parsed as object, ESPLORA_REGTEST_BLOCKCHAIN)
  );
}

/**
 * Boot check for the regtest Esplora upstream. Throws on `prd` when `ESPLORA_REGTEST_URL` is set,
 * in every environment when `ESPLORA_BASE_URLS` names `BitcoinRegtest`, and in every environment
 * when `ESPLORA_REGTEST_URL` is set but invalid.
 */
export function assertEsploraRegtestConfig(environment: string, config: Record<string, unknown>): void {
  if (hasRegtestKey(config.ESPLORA_BASE_URLS)) {
    throw new Error(`ESPLORA_BASE_URLS must not contain ${ESPLORA_REGTEST_BLOCKCHAIN}; use ESPLORA_REGTEST_URL`);
  }
  if (!isSet(config.ESPLORA_REGTEST_URL)) {
    return;
  }
  if (!ESPLORA_REGTEST_ENVIRONMENTS.includes(environment)) {
    throw new Error(`ESPLORA_REGTEST_URL must not be set when ENVIRONMENT is ${environment}`);
  }
  parseEsploraRegtestOrigin(config.ESPLORA_REGTEST_URL);
}

/**
 * Request-time resolution. Never throws: returns `undefined` (answered as 404 `EsploraNotConfigured`)
 * outside stg, dev, and loc, and when the variable is unset or invalid.
 */
export function resolveEsploraRegtestOrigin(environment: unknown, raw: unknown): string | undefined {
  if (typeof environment !== 'string' || !ESPLORA_REGTEST_ENVIRONMENTS.includes(environment)) {
    return undefined;
  }
  try {
    return parseEsploraRegtestOrigin(raw);
  } catch {
    return undefined;
  }
}

/**
 * The request-time upstream of `BitcoinRegtest`. Fails closed: returns `undefined` whenever boot would
 * have refused the configuration, so a `BitcoinRegtest` key in `ESPLORA_BASE_URLS` is never used and
 * also blocks `ESPLORA_REGTEST_URL`. Otherwise defers to `resolveEsploraRegtestOrigin`.
 */
export function resolveEsploraRegtestUpstream(
  environment: unknown,
  rawRegtestUrl: unknown,
  rawBaseUrls: unknown,
): string | undefined {
  if (hasRegtestKey(rawBaseUrls)) {
    return undefined;
  }
  return resolveEsploraRegtestOrigin(environment, rawRegtestUrl);
}
