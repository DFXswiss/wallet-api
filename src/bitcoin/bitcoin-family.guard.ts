import { CanActivate, Injectable } from '@nestjs/common';
import { WalletFamilies, WalletFamily } from '../config/wallet-families';

// Every Bitcoin route blockchain (Bitcoin, BitcoinTestnet4, BitcoinRegtest) belongs to the bitcoin family.
export const BITCOIN_ROUTE_FAMILY: WalletFamily = 'bitcoin';

// The wallet family switch for every /v1/wallet/bitcoin/:blockchain/* route. It is the first guard of the controller,
// so a request while the bitcoin family is off answers 403 WalletFamilyDisabled before the SessionGuard (no session
// lookup), before the ValidationPipe, and before any blockchain resolution, database access, or Esplora request.
@Injectable()
export class BitcoinFamilyGuard implements CanActivate {
  constructor(private readonly families: WalletFamilies) {}

  canActivate(): true {
    this.families.assertEnabled(BITCOIN_ROUTE_FAMILY);
    return true;
  }
}
