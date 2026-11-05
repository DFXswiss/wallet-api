import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { SessionAccountService } from './session-account.service';
import { AuthenticatedRequest, readBearerToken } from './session.guard';

@Injectable()
export class OptionalSessionGuard implements CanActivate {
  constructor(private readonly accounts: SessionAccountService) {}

  async canActivate(context: ExecutionContext): Promise<true> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readBearerToken(request);
    if (token) {
      request.walletAccountId = await this.accounts.requireAccountId(token);
    }
    return true;
  }
}
