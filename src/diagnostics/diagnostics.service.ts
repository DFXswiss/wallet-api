import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PasskeyDiagnostic } from '../entities/passkey-diagnostic.entity';

@Injectable()
export class DiagnosticsService {
  constructor(
    @InjectRepository(PasskeyDiagnostic)
    private readonly diagnostics: Repository<PasskeyDiagnostic>,
  ) {}

  async store(walletAccountId: string | null, payload: Record<string, unknown>): Promise<void> {
    const record = this.diagnostics.create({ walletAccountId, payload });
    await this.diagnostics.save(record);
  }
}
