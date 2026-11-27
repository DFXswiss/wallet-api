import { EnvironmentConfig } from './environment-config';

// DEV: the configuration of this environment, selected by ENVIRONMENT=dev.
export const DevEnvironment: EnvironmentConfig = {
  // Owner decision 2026-11-27: the wallet starts with Bitcoin on-chain only; Spark and EVM are not offered.
  walletFamilies: {
    bitcoin: true, // Bitcoin on-chain: Esplora proxy, bitcoin addresses
    spark: false, // Spark and Lightning: spark addresses, LNURL and Lightning-address lookup (403 while off)
    evm: false, // EVM: JSON-RPC proxy, ENS lookup, ethereum addresses (403 while off)
  },
};
