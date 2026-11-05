import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthenticatedRequest, readBearerToken } from './session.guard';
import { SessionService } from './session.service';

@Injectable()
export class OptionalSessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<true> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readBearerToken(request);
    if (token) {
      const claims = await this.sessions.verify(token);
      request.walletAccountId = claims.sub;
    }
    return true;
  }
}
