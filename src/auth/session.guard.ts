import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { walletError } from '../common/wallet-error';
import { SessionService } from './session.service';

export type AuthenticatedRequest = Request & { walletAccountId?: string };

export function readBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header) {
    return undefined;
  }
  const [scheme, token, ...extra] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token || extra.length > 0) {
    return undefined;
  }
  return token;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<true> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readBearerToken(request);
    if (!token) {
      throw walletError(401, 'SessionRequired');
    }
    const claims = await this.sessions.verify(token);
    request.walletAccountId = claims.sub;
    return true;
  }
}
