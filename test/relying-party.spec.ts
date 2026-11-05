import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { evaluateRelyingParty } from '../src/config/relying-party';
import { RelyingPartyService } from '../src/config/relying-party.service';
import { parseEnvironment } from '../src/config/environment';
import { PasskeyConfiguredGuard } from '../src/passkey/passkey-configured.guard';

describe('relying party validation', () => {
  it('accepts the exact prd pair', () => {
    expect(evaluateRelyingParty('prd', 'app.dfx.swiss', 'https://app.dfx.swiss')).toEqual({
      configured: true,
      rpId: 'app.dfx.swiss',
      origin: 'https://app.dfx.swiss',
    });
  });

  it('accepts the exact stg pair', () => {
    expect(evaluateRelyingParty('stg', 'stg.app.dfx.swiss', 'https://stg.app.dfx.swiss')).toEqual({
      configured: true,
      rpId: 'stg.app.dfx.swiss',
      origin: 'https://stg.app.dfx.swiss',
    });
  });

  it('rejects the prd rp id on stg', () => {
    expect(evaluateRelyingParty('stg', 'app.dfx.swiss', 'https://app.dfx.swiss').configured).toBe(false);
  });

  it('rejects the production rp id on dev', () => {
    expect(evaluateRelyingParty('dev', 'app.dfx.swiss', 'https://app.dfx.swiss').configured).toBe(false);
  });

  it('rejects a production suffix on dev', () => {
    expect(evaluateRelyingParty('dev', 'evil.app.dfx.swiss', 'https://evil.app.dfx.swiss').configured).toBe(false);
  });

  it('accepts plain http localhost on loc', () => {
    expect(evaluateRelyingParty('loc', 'localhost', 'http://localhost')).toEqual({
      configured: true,
      rpId: 'localhost',
      origin: 'http://localhost',
    });
  });

  it('rejects plain http localhost on dev', () => {
    expect(evaluateRelyingParty('dev', 'localhost', 'http://localhost').configured).toBe(false);
  });

  it('rejects a trailing slash origin', () => {
    expect(evaluateRelyingParty('loc', 'localhost', 'http://localhost/').configured).toBe(false);
  });

  it('treats a missing pair as unconfigured and returns 503 from the passkey guard', () => {
    expect(evaluateRelyingParty('dev', undefined, undefined).configured).toBe(false);
    const config = new ConfigService({ ENVIRONMENT: 'dev' });
    const service = new RelyingPartyService(config);
    expect(service.isConfigured).toBe(false);
    const readParty = () => service.relyingParty;
    expect(readParty).toThrow(HttpException);
    try {
      readParty();
    } catch (error) {
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(503);
      expect((exception.getResponse() as { code: string }).code).toBe('PasskeyNotConfigured');
    }
    expect(() => new PasskeyConfiguredGuard(service).canActivate()).toThrow(HttpException);
  });

  it('refuses a missing or unknown environment', () => {
    expect(() => parseEnvironment(undefined)).toThrow();
    expect(() => parseEnvironment('qa')).toThrow();
  });
});
