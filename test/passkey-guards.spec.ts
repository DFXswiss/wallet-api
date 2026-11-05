import { HttpException } from '@nestjs/common';
import { PasskeyService } from '../src/passkey/passkey.service';
import { hasPrfResults, readAuthenticatorAttachment } from '../src/passkey/webauthn.verifier';

async function captureError(operation: Promise<unknown>): Promise<HttpException> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof HttpException) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected the operation to fail');
}

describe('passkey request guards', () => {
  it('refuses PRF results', () => {
    expect(hasPrfResults({ clientExtensionResults: { prf: { results: { enabled: true } } } })).toBe(true);
    expect(hasPrfResults({ clientExtensionResults: { prf: { results: {} } } })).toBe(true);
    expect(hasPrfResults({ clientExtensionResults: { prf: {} } })).toBe(false);
    expect(hasPrfResults({})).toBe(false);
  });

  it('detects a cross-platform registration attachment', () => {
    expect(readAuthenticatorAttachment({ authenticatorAttachment: 'cross-platform' })).toBe('cross-platform');
    expect(readAuthenticatorAttachment({ response: { authenticatorAttachment: 'cross-platform' } })).toBe(
      'cross-platform',
    );
    expect(readAuthenticatorAttachment({ authenticatorAttachment: 'platform' })).toBe('platform');
  });

  it('keeps challenge errors at HTTP 400', () => {
    const error = new HttpException({ code: 'ChallengeInvalid' }, 400);
    expect(error.getStatus()).toBe(400);
  });

  it('refuses PRF registration before reading or verifying a challenge', async () => {
    const relyingParty = {
      assertConfigured: () => ({ rpId: 'localhost', origin: 'https://localhost' }),
    };
    const challenges = { findOneBy: jest.fn() };
    const verifier = { verifyRegistration: jest.fn(), verifyAuthentication: jest.fn() };
    const service = new PasskeyService(
      {} as any,
      challenges as any,
      relyingParty as any,
      {} as any,
      {} as any,
      verifier as any,
    );
    const error = await captureError(
      service.finishRegistration({
        challengeId: 'a',
        response: {
          id: 'credential',
          rawId: 'credential',
          type: 'public-key',
          clientExtensionResults: { prf: { results: { first: 'secret' } } },
          response: { clientDataJSON: 'e30', attestationObject: 'e30' },
        },
      }),
    );
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({ code: 'PrfResultsRefused' });
    expect(challenges.findOneBy).not.toHaveBeenCalled();
    expect(verifier.verifyRegistration).not.toHaveBeenCalled();
  });

  it('refuses a cross-platform registration before reading or verifying a challenge', async () => {
    const relyingParty = {
      assertConfigured: () => ({ rpId: 'localhost', origin: 'https://localhost' }),
    };
    const challenges = { findOneBy: jest.fn() };
    const verifier = { verifyRegistration: jest.fn(), verifyAuthentication: jest.fn() };
    const service = new PasskeyService(
      {} as any,
      challenges as any,
      relyingParty as any,
      {} as any,
      {} as any,
      verifier as any,
    );
    const error = await captureError(
      service.finishRegistration({
        challengeId: 'a',
        response: {
          id: 'credential',
          rawId: 'credential',
          type: 'public-key',
          authenticatorAttachment: 'cross-platform',
          clientExtensionResults: {},
          response: { clientDataJSON: 'e30', attestationObject: 'e30' },
        },
      }),
    );
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({ code: 'CrossDeviceRegistration' });
    expect(challenges.findOneBy).not.toHaveBeenCalled();
    expect(verifier.verifyRegistration).not.toHaveBeenCalled();
  });
});
