import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { walletError } from '../common/wallet-error';
import { RelyingParty, evaluateRelyingParty } from './relying-party';

@Injectable()
export class RelyingPartyService {
  constructor(private readonly config: ConfigService) {}

  get status() {
    return evaluateRelyingParty(
      this.config.get<string>('ENVIRONMENT'),
      this.config.get<string>('PASSKEY_RP_ID'),
      this.config.get<string>('PASSKEY_ORIGIN'),
    );
  }

  get isConfigured(): boolean {
    return this.status.configured;
  }

  assertConfigured(): RelyingParty {
    return this.relyingParty;
  }

  get relyingParty(): RelyingParty {
    const status = this.status;
    if (!status.configured) {
      throw walletError(503, 'PasskeyNotConfigured');
    }
    return { rpId: status.rpId, origin: status.origin };
  }
}
