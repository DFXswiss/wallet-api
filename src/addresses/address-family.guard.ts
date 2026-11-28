import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { WalletFamilies, chainFamily, isWalletChainId } from '../config/wallet-families';

// Refuses PUT /v1/wallet/addresses for a chain whose family is off. Nest runs guards before pipes, so this check
// comes before the global ValidationPipe validates UpsertAddressDto; it runs after the controller's SessionGuard.
// A missing or unknown chain passes here and the ValidationPipe answers 400 as before.
@Injectable()
export class AddressFamilyGuard implements CanActivate {
  constructor(private readonly families: WalletFamilies) {}

  canActivate(context: ExecutionContext): true {
    const request = context.switchToHttp().getRequest<Request>();
    const body: unknown = request.body;
    const chain = body && typeof body === 'object' ? (body as Record<string, unknown>).chain : undefined;
    if (isWalletChainId(chain)) {
      this.families.assertEnabled(chainFamily(chain));
    }
    return true;
  }
}
