import type { WalletEnvironment } from '../environment';
import { DevEnvironment } from './dev';
import { EnvironmentConfig } from './environment-config';
import { LocEnvironment } from './loc';
import { PrdEnvironment } from './prd';
import { StgEnvironment } from './stg';

export * from './environment-config';

// Keyed by the ENVIRONMENT values. There is no fallback: ENVIRONMENT is required (src/config/environment.ts).
export const ENVIRONMENT_CONFIGS: Readonly<Record<WalletEnvironment, EnvironmentConfig>> = {
  prd: PrdEnvironment,
  stg: StgEnvironment,
  dev: DevEnvironment,
  loc: LocEnvironment,
};
