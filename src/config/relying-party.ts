import { WalletEnvironment, isKnownEnvironment } from './environment';

export type RelyingParty = {
  rpId: string;
  origin: string;
};

const PRODUCTION_RP_ID = 'app.dfx.swiss';
const PRODUCTION_ORIGIN = 'https://app.dfx.swiss';
const STAGING_RP_ID = 'stg.app.dfx.swiss';
const STAGING_ORIGIN = 'https://stg.app.dfx.swiss';

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

  if (rpIdInput === PRODUCTION_RP_ID || rpIdInput.endsWith(`.${PRODUCTION_RP_ID}`)) {
    return { configured: false };
  }

  return evaluateOrigin(rpIdInput, originInput, environment)
    ? { configured: true, rpId: rpIdInput, origin: originInput }
    : { configured: false };
}
