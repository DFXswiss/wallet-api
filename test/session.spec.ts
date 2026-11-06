import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  SessionService,
  WALLET_SESSION_AUDIENCE,
  WALLET_SESSION_ISSUER,
  sessionStillCurrent,
} from '../src/auth/session.service';

describe('wallet session tokens', () => {
  const previousSecret = process.env.WALLET_SESSION_SECRET;

  afterEach(() => {
    if (previousSecret === undefined) {
      delete process.env.WALLET_SESSION_SECRET;
    } else {
      process.env.WALLET_SESSION_SECRET = previousSecret;
    }
  });

  it('issues an HMAC token with the wallet issuer and audience', async () => {
    const secret = 'a-test-session-secret-with-at-least-32-characters';
    delete process.env.WALLET_SESSION_SECRET;
    const config = new ConfigService({ WALLET_SESSION_SECRET: secret });
    const service = new SessionService(new JwtService(), config);
    const token = service.issue('5b2f1d94-2b5a-4f45-bca2-4a2e7f9e2028');
    const payload = await new JwtService().verifyAsync(token, { secret });
    expect(payload.iss).toBe(WALLET_SESSION_ISSUER);
    expect(payload.aud).toBe(WALLET_SESSION_AUDIENCE);
    expect(payload.sub).toBe('5b2f1d94-2b5a-4f45-bca2-4a2e7f9e2028');
    expect(payload.exp - payload.iat).toBe(12 * 60 * 60);
    expect(service.issue('another-id')).not.toBe(token);
  });

  it('rejects a token issued in the same second as revocation', () => {
    const cutoff = new Date('2026-11-05T10:00:00.500Z');
    const iat = Math.floor(cutoff.getTime() / 1000);
    expect(sessionStillCurrent(iat, cutoff)).toBe(false);
    expect(sessionStillCurrent(iat + 1, cutoff)).toBe(true);
    expect(sessionStillCurrent(iat, null)).toBe(true);
  });

  it('refuses a session secret shorter than 32 characters at boot', () => {
    delete process.env.WALLET_SESSION_SECRET;
    const config = new ConfigService({ WALLET_SESSION_SECRET: 'short' });
    const service = new SessionService(new JwtService(), config);
    expect(() => service.onModuleInit()).toThrow();
  });
});
