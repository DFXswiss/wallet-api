import { CanActivate, Injectable } from '@nestjs/common';
import { RelyingPartyService } from '../config/relying-party.service';

@Injectable()
export class PasskeyConfiguredGuard implements CanActivate {
  constructor(private readonly relyingParty: RelyingPartyService) {}

  canActivate(): true {
    this.relyingParty.assertConfigured();
    return true;
  }
}
