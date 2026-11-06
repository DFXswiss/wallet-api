import { HttpException } from '@nestjs/common';
import {
  DIAGNOSTIC_RETENTION_MS,
  DiagnosticsService,
  MAX_LIVE_DIAGNOSTICS,
} from '../src/diagnostics/diagnostics.service';

describe('diagnostic quota', () => {
  it('deletes rows older than a day and refuses the next row at the cap', async () => {
    const events: string[] = [];
    let cutoff: Date | undefined;
    const diagnostics = {
      createQueryBuilder: (alias?: string) => {
        if (alias) {
          events.push('count');
          return { getCount: async () => MAX_LIVE_DIAGNOSTICS };
        }
        events.push('sweep');
        const deleted = {
          delete: () => deleted,
          from: () => deleted,
          where: (_sql: string, params: { cutoff: Date }) => {
            cutoff = params.cutoff;
            return deleted;
          },
          execute: async () => ({ affected: 1 }),
        };
        return deleted;
      },
      create: (data: unknown) => data,
      save: async () => {
        events.push('save');
      },
    };
    const dataSource = {
      transaction: async (run: (manager: unknown) => Promise<unknown>) =>
        run({
          query: async (sql: string) => {
            expect(sql).toContain('pg_advisory_xact_lock');
            events.push('lock');
          },
          withRepository: () => diagnostics,
        }),
    };
    const service = new DiagnosticsService({} as any, dataSource as any);
    const before = Date.now();
    try {
      await service.store(null, { ok: true });
      throw new Error('Expected the store to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).getResponse()).toMatchObject({ code: 'DiagnosticRateLimited' });
    }
    expect(events).toEqual(['lock', 'sweep', 'count']);
    expect(cutoff).toBeInstanceOf(Date);
    expect(before - cutoff!.getTime()).toBeGreaterThanOrEqual(DIAGNOSTIC_RETENTION_MS - 50);
    expect(before - cutoff!.getTime()).toBeLessThanOrEqual(DIAGNOSTIC_RETENTION_MS + 5_000);
  });
});
