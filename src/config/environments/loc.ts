import { EnvironmentConfig } from './environment-config';

// LOC: the configuration of local development and the test suite, selected by ENVIRONMENT=loc. It matches the
// deployed environments, so a local run shows what the app shows in production.
export const LocEnvironment: EnvironmentConfig = {
  // Owner decision 2026-11-27: the wallet starts with Bitcoin on-chain only; Spark and EVM are not offered.
  walletFamilies: {
    bitcoin: true, // Bitcoin on-chain: Esplora proxy, bitcoin addresses, /v1/wallet/bitcoin/* routes
    spark: false, // Spark and Lightning: spark addresses, LNURL and Lightning-address lookup (403 while off)
    evm: false, // EVM: JSON-RPC proxy, ENS lookup, ethereum addresses (403 while off)
  },
};
