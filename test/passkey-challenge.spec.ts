import { HttpException } from '@nestjs/common';
import { MAX_LIVE_CHALLENGES, PasskeyService } from '../src/passkey/passkey.service';
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
          delete: () => builder,
          from: () => builder,
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

  it('deletes expired challenges and refuses a new one at the live cap', async () => {
    const events: string[] = [];
    const saved: Array<{ id?: string }> = [];
    const challenges = challengeRepository(events, saved, MAX_LIVE_CHALLENGES);
    const service = new PasskeyService(
      {} as any,
      {} as any,
      { assertConfigured: () => ({ rpId: 'localhost', origin: 'https://localhost' }) } as any,
      {} as any,
      { transaction: async (run: (manager: unknown) => Promise<unknown>) => run(challenges.manager) } as any,
      {} as any,
    );
    const error = await captureError((service as any).storeChallenge('abc', 'register', null, 'preset-id'));
    expect(error.getStatus()).toBe(429);
    expect(error.getResponse()).toMatchObject({ code: 'ChallengeRateLimited' });
    expect(events).toEqual(['lock', 'sweep', 'count']);
    expect(saved).toEqual([]);

    const accepted: string[] = [];
    const open = challengeRepository(accepted, saved, MAX_LIVE_CHALLENGES - 1);
    const openService = new PasskeyService(
      {} as any,
      {} as any,
      { assertConfigured: () => ({ rpId: 'localhost', origin: 'https://localhost' }) } as any,
      {} as any,
      { transaction: async (run: (manager: unknown) => Promise<unknown>) => run(open.manager) } as any,
      {} as any,
    );
    await expect((openService as any).storeChallenge('abc', 'register', null, 'preset-id')).resolves.toMatchObject({
      id: 'preset-id',
    });
    expect(accepted).toEqual(['lock', 'sweep', 'count', 'save']);
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe('preset-id');
  });

  it('locks the credential before it samples the revocation clock', async () => {
    const events: string[] = [];
    const updates: Array<{ revokedAt?: Date; sessionValidAfter?: Date }> = [];
    const challengeId = '00000000-0000-4000-8000-000000000001';
    const accountId = '00000000-0000-4000-8000-000000000002';
    const clientDataJSON = Buffer.from(JSON.stringify({ challenge: 'abc' })).toString('base64url');
    const credential = {
      id: 'cred-row',
      credentialId: 'cred',
      publicKey: 'pk',
      walletAccountId: accountId,
      revokedAt: null,
      transports: '[]',
    };
    const manager = {
      createQueryBuilder: (entity?: unknown) => {
        if (entity) {
          const builder = {
            setLock: () => {
              events.push('lock');
              return builder;
            },
            where: () => builder,
            andWhere: () => builder,
            getOne: async () => credential,
          };
          return builder;
        }
        const deleted = {
          delete: () => deleted,
          from: () => deleted,
          where: () => deleted,
          andWhere: () => deleted,
          execute: async () => ({ affected: 1 }),
        };
        return deleted;
      },
      update: async (_entity: unknown, _criteria: unknown, values: { revokedAt?: Date; sessionValidAfter?: Date }) => {
        updates.push(values);
        return { affected: 1 };
      },
    };
    const service = new PasskeyService(
      { findOneBy: async () => credential } as any,
      {
        findOneBy: async () => ({
          id: challengeId,
          purpose: 'revoke',
          challenge: 'abc',
          usedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          walletAccountId: accountId,
        }),
      } as any,
      { assertConfigured: () => ({ rpId: 'localhost', origin: 'https://localhost' }) } as any,
      {} as any,
      { transaction: async (run: (tx: typeof manager) => Promise<unknown>) => run(manager) } as any,
      { verifyAuthentication: async () => ({ verified: true }) } as any,
    );
    const stamped = new Date('2026-11-05T12:00:01.250Z');
    (service as any).currentTime = () => {
      events.push('now');
      return stamped;
    };
    await expect(
      service.finishRevocation(accountId, {
        challengeId,
        response: { id: 'cred', response: { clientDataJSON } },
      }),
    ).resolves.toEqual({ revokedAt: stamped.toISOString() });
    expect(events).toEqual(['lock', 'now']);
    expect(updates).toEqual([{ revokedAt: stamped }, { sessionValidAfter: stamped }]);
  });
});

function challengeRepository(events: string[], saved: Array<{ id?: string }>, live: number) {
  const repository = {
    createQueryBuilder: (alias?: string) => {
      if (alias) {
        events.push('count');
        return { where: () => ({ getCount: async () => live }) };
      }
      events.push('sweep');
      const deleted = {
        delete: () => deleted,
        from: () => deleted,
        where: () => deleted,
        execute: async () => ({ affected: 0 }),
      };
      return deleted;
    },
    create: (data: { id?: string }) => data,
    save: async (record: { id?: string }) => {
      events.push('save');
      saved.push(record);
      return record;
    },
  };
  return {
    manager: {
      query: async (sql: string) => {
        expect(sql).toContain('pg_advisory_xact_lock');
        events.push('lock');
      },
      withRepository: () => repository,
    },
  };
}
