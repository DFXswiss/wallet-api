import { WalletEnvironment, isKnownEnvironment } from './environment';

export type RelyingParty = {
  rpId: string;
  origin: string;
};

const PRODUCTION_RP_ID = 'app.dfx.swiss';
const PRODUCTION_ORIGIN = 'https://app.dfx.swiss';
const STAGING_RP_ID = 'stg.app.dfx.swiss';
const STAGING_ORIGIN = 'https://stg.app.dfx.swiss';
const DEVELOPMENT_RP_ID = 'dev.app.dfx.swiss';
const DEVELOPMENT_ORIGIN = 'https://dev.app.dfx.swiss';

function evaluateOrigin(rpId: string, origin: string, environment: WalletEnvironment): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) {
    return false;
  }
  if (parsed.protocol !== 'https:' && !(environment === 'loc' && parsed.protocol === 'http:')) {
    return false;
  }
  if (parsed.origin !== origin) {
    return false;
  }
  return parsed.hostname === rpId;
}

export function evaluateRelyingParty(
  environmentInput: string | undefined,
  rpIdInput: string | undefined,
  originInput: string | undefined,
): { configured: false; rpId?: undefined; origin?: undefined } | { configured: true; rpId: string; origin: string } {
  if (!isKnownEnvironment(environmentInput)) {
    return { configured: false };
  }
  const environment = environmentInput;
  if (!rpIdInput || !originInput) {
    return { configured: false };
  }
  if (rpIdInput.endsWith('.') || rpIdInput !== rpIdInput.toLowerCase()) {
    return { configured: false };
  }

  if (environment === 'prd') {
    return rpIdInput === PRODUCTION_RP_ID && originInput === PRODUCTION_ORIGIN
      ? { configured: true, rpId: rpIdInput, origin: originInput }
      : { configured: false };
  }

  if (environment === 'stg') {
    return rpIdInput === STAGING_RP_ID && originInput === STAGING_ORIGIN
      ? { configured: true, rpId: rpIdInput, origin: originInput }
      : { configured: false };
  }

  if (environment === 'dev' && rpIdInput === DEVELOPMENT_RP_ID) {
    return originInput === DEVELOPMENT_ORIGIN
      ? { configured: true, rpId: rpIdInput, origin: originInput }
      : { configured: false };
  }

  // An app.dfx.swiss credential works from any *.app.dfx.swiss page, so dev and loc reject that production
  // RP id and every host under it; the dev host uses its own RP id.
  if (
    rpIdInput === PRODUCTION_RP_ID ||
    rpIdInput.endsWith(`.${PRODUCTION_RP_ID}`) ||
    PRODUCTION_RP_ID.endsWith(`.${rpIdInput}`)
  ) {
    return { configured: false };
  }

  return evaluateOrigin(rpIdInput, originInput, environment)
    ? { configured: true, rpId: rpIdInput, origin: originInput }
    : { configured: false };
}
