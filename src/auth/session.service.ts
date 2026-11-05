import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { walletError } from '../common/wallet-error';

export const WALLET_SESSION_ISSUER = 'wallet-api';
export const WALLET_SESSION_AUDIENCE = 'wallet';
export const WALLET_SESSION_TTL_SECONDS = 12 * 60 * 60;

export type WalletSessionClaims = {
  sub: string;
  iss: string;
  aud: string;
};

@Injectable()
export class SessionService implements OnModuleInit {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const secret = this.config.get<string>('WALLET_SESSION_SECRET');
    if (!secret || secret.length < 32) {
      throw new Error('WALLET_SESSION_SECRET must contain at least 32 characters');
    }
  }

  issue(walletAccountId: string): string {
    return this.jwt.sign(
      { sub: walletAccountId },
      {
        secret: this.config.get<string>('WALLET_SESSION_SECRET'),
        issuer: WALLET_SESSION_ISSUER,
        audience: WALLET_SESSION_AUDIENCE,
        expiresIn: WALLET_SESSION_TTL_SECONDS,
        algorithm: 'HS256',
      },
    );
  }

  async verify(token: string): Promise<WalletSessionClaims> {
    try {
      const payload = await this.jwt.verifyAsync<Record<string, unknown>>(token, {
        secret: this.config.get<string>('WALLET_SESSION_SECRET'),
        issuer: WALLET_SESSION_ISSUER,
        audience: WALLET_SESSION_AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw walletError(401, 'SessionInvalid');
      }
      return { sub: payload.sub, iss: WALLET_SESSION_ISSUER, aud: WALLET_SESSION_AUDIENCE };
    } catch {
      throw walletError(401, 'SessionInvalid');
    }
  }
}
