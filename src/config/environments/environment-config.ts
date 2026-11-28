import type { WalletFamily } from '../wallet-families';

// The configuration of one environment that belongs in the repository. Secrets and deployment wiring stay in
// environment variables (README.md, section "Configuration").
//
// `walletFamilies`: one switch per chain family the passkey wallet offers, true = on, false = off. The record
// lists every family, so a new family does not compile until every environment file says whether it is on.
// Changing a value needs a reviewed pull request and a deploy; no environment variable can switch a family on.
export interface EnvironmentConfig {
  walletFamilies: Record<WalletFamily, boolean>;
}
