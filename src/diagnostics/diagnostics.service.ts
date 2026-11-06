import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { walletError } from '../common/wallet-error';
import { PasskeyDiagnostic } from '../entities/passkey-diagnostic.entity';

export const MAX_LIVE_DIAGNOSTICS = 500;
export const DIAGNOSTIC_RETENTION_MS = 24 * 60 * 60 * 1000;
const DIAGNOSTIC_ADVISORY_LOCK = '481201002';

@Injectable()
export class DiagnosticsService {
  constructor(
    @InjectRepository(PasskeyDiagnostic)
    private readonly diagnostics: Repository<PasskeyDiagnostic>,
    private readonly dataSource: DataSource,
  ) {}

  async store(walletAccountId: string | null, payload: Record<string, unknown>): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1::bigint)', [DIAGNOSTIC_ADVISORY_LOCK]);
      const cutoff = new Date(Date.now() - DIAGNOSTIC_RETENTION_MS);
      const diagnostics = manager.withRepository(this.diagnostics);
      await diagnostics
        .createQueryBuilder()
        .delete()
        .from(PasskeyDiagnostic)
        .where('created_at <= :cutoff', { cutoff })
        .execute();
      const live = await diagnostics.createQueryBuilder('diagnostic').getCount();
      if (live >= MAX_LIVE_DIAGNOSTICS) {
        throw walletError(429, 'DiagnosticRateLimited');
      }
      const record = diagnostics.create({ walletAccountId, payload });
      await diagnostics.save(record);
    });
  }
}
