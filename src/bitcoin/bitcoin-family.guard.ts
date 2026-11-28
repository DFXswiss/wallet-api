import { CanActivate, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { walletError } from '../common/wallet-error';

/**
 * The single hook point for the wallet family switch. Every `/v1/wallet/bitcoin/*` route passes through it.
 * The `bitcoin` family is on until the family switches land; that change replaces this body with the switch for
 * `bitcoin` and nothing else in this module.
 */
export function bitcoinFamilyEnabled(_config: ConfigService): boolean {
  return true;
}

@Injectable()
export class BitcoinFamilyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): true {
    if (!bitcoinFamilyEnabled(this.config)) {
      throw walletError(404, 'WalletFamilyDisabled');
    }
    return true;
  }
}
