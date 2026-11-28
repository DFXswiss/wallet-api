import { WalletFamilies } from '../src/config/wallet-families';

// Every family on: for the tests of a family's own behaviour behind its switch.
export function allFamiliesOn(): WalletFamilies {
  return new WalletFamilies({ bitcoin: true, spark: true, evm: true });
}

// The launch configuration of every environment (owner decision 2026-11-27).
export function launchFamilies(): WalletFamilies {
  return new WalletFamilies({ bitcoin: true, spark: false, evm: false });
}

// Every family off: for the Bitcoin refusal paths.
export function allFamiliesOff(): WalletFamilies {
  return new WalletFamilies({ bitcoin: false, spark: false, evm: false });
}
