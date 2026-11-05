import { HttpException } from '@nestjs/common';
import { PasskeyService } from '../src/passkey/passkey.service';
import { WalletErrors } from '../src/common/wallet-error';

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

describe('single-use passkey challenges', () => {
  it('cannot consume a challenge twice', async () => {
    let used = false;
    const challenges = {
      createQueryBuilder: jest.fn(() => {
        let id = '';
        const builder = {
          update: () => builder,
          set: () => builder,
          where: (_sql: string, params: { id: string }) => {
            id = params.id;
            return builder;
          },
          andWhere: () => builder,
          execute: async () => {
            expect(id).toBe('challenge-1');
            if (used) {
              return { affected: 0 };
            }
            used = true;
            return { affected: 1 };
          },
        };
        return builder;
      }),
    };
    const service = new PasskeyService(
      {} as any,
      challenges as any,
      { assertConfigured: () => ({ rpId: 'localhost', origin: 'https://localhost' }) } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const consume = (service as any).consumeChallenge.bind(service);
    await expect(consume('challenge-1')).resolves.toBeUndefined();
    const error = await captureError(consume('challenge-1'));
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({ code: 'ChallengeInvalid' });
    expect(WalletErrors.challengeInvalid().getStatus()).toBe(400);
  });

  it('rejects an expired challenge before verification', async () => {
    const challengeId = '00000000-0000-4000-8000-000000000001';
    const challenges = {
      findOneBy: jest.fn(async () => ({
        id: challengeId,
        purpose: 'register',
        challenge: 'abc',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1),
      })),
    };
    const service = new PasskeyService(
      {} as any,
      challenges as any,
      { assertConfigured: () => ({ rpId: 'localhost', origin: 'https://localhost' }) } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(
      (service as any).findUsableChallenge(Buffer.from('{}').toString('base64url'), challengeId, 'register'),
    ).rejects.toMatchObject({ status: 400 });
  });
});
