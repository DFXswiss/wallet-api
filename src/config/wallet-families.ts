import type { WalletChainId } from '../entities/passkey-address.entity';
import { WalletErrors } from '../common/wallet-error';
import type { WalletEnvironment } from './environment';
import { ENVIRONMENT_CONFIGS } from './environments';

// The chain families the passkey wallet can offer. Which of them are on is set per environment in
// src/config/environments/<env>.ts and returned by GET /v1/wallet/config.
export const WALLET_FAMILIES = ['bitcoin', 'spark', 'evm'] as const;

export type WalletFamily = (typeof WALLET_FAMILIES)[number];

export type WalletFamilySwitches = Readonly<Record<WalletFamily, boolean>>;

// The family each stored address chain belongs to.
const CHAIN_FAMILIES: Readonly<Record<WalletChainId, WalletFamily>> = {
  bitcoin: 'bitcoin',
  spark: 'spark',
  ethereum: 'evm',
};

export function chainFamily(chain: WalletChainId): WalletFamily {
  return CHAIN_FAMILIES[chain];
}

// True only for a stored address chain this service knows, never for an inherited key such as "__proto__".
export function isWalletChainId(value: unknown): value is WalletChainId {
  return typeof value === 'string' && Object.hasOwn(CHAIN_FAMILIES, value);
}

export function isWalletFamily(value: unknown): value is WalletFamily {
  return typeof value === 'string' && (WALLET_FAMILIES as readonly string[]).includes(value);
}

// Checks one switch record: exactly the known families, each true or false. Anything else stops boot, so a missing
// or mistyped value never falls back to a default.
export function parseWalletFamilySwitches(value: unknown, source: string): WalletFamilySwitches {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source}: walletFamilies must be an object`);
  }
  const record = value as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !isWalletFamily(key));
  if (unknownKeys.length > 0) {
    throw new Error(`${source}: unknown wallet families ${unknownKeys.join(', ')}`);
  }
  const switches = {} as Record<WalletFamily, boolean>;
  for (const family of WALLET_FAMILIES) {
    const flag = Object.hasOwn(record, family) ? record[family] : undefined;
    if (flag !== true && flag !== false) {
      throw new Error(`${source}: walletFamilies.${family} must be true or false`);
    }
    switches[family] = flag;
  }
  return Object.freeze(switches);
}

// The switches of one environment, checked.
export function readWalletFamilies(environment: WalletEnvironment): WalletFamilySwitches {
  const config = Object.hasOwn(ENVIRONMENT_CONFIGS, environment) ? ENVIRONMENT_CONFIGS[environment] : undefined;
  if (!config) {
    throw new Error(`No environment configuration for ${environment}`);
  }
  return parseWalletFamilySwitches(config.walletFamilies, `src/config/environments/${environment}.ts`);
}

export type WalletConfigResponse = {
  families: Record<WalletFamily, boolean>;
};

// The switches of the running process, read once when the application starts (WalletConfigModule).
export class WalletFamilies {
  private readonly switches: WalletFamilySwitches;

  constructor(switches: WalletFamilySwitches) {
    this.switches = parseWalletFamilySwitches(switches, 'WalletFamilies');
  }

  isEnabled(family: WalletFamily): boolean {
    return this.switches[family] === true;
  }

  // Refuses a request of a family that is off. Callers place it before any lookup or outbound request; on
  // PUT /v1/wallet/addresses the AddressFamilyGuard calls it before the ValidationPipe as well.
  assertEnabled(family: WalletFamily): void {
    if (!this.isEnabled(family)) {
      throw WalletErrors.walletFamilyDisabled();
    }
  }

  // The response of GET /v1/wallet/config: every family with its switch, never a missing key.
  toResponse(): WalletConfigResponse {
    const families = {} as Record<WalletFamily, boolean>;
    for (const family of WALLET_FAMILIES) {
      families[family] = this.switches[family];
    }
    return { families };
  }
}
