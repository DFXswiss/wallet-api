import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { walletError } from '../common/wallet-error';
import { BitcoinPreparedPayment } from '../entities/bitcoin-prepared-payment.entity';
import { MAX_LIVE_PREPARES, PREPARE_RETENTION_MS } from './bitcoin-limits';

const BITCOIN_PREPARE_ADVISORY_LOCK = 481201003;

export type NewPreparedPayment = Pick<
  BitcoinPreparedPayment,
  'walletAccountId' | 'blockchain' | 'txid' | 'psbt' | 'inputs' | 'outputs' | 'amount' | 'fee' | 'feeRate' | 'expiresAt'
>;

@Injectable()
export class BitcoinPaymentStore {
  constructor(
    @InjectRepository(BitcoinPreparedPayment)
    private readonly payments: Repository<BitcoinPreparedPayment>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Stores a prepared payment. Under a per-account advisory lock it deletes rows that expired more than
   * {@link PREPARE_RETENTION_MS} ago and refuses with 429 `PrepareRateLimited` once the account has
   * {@link MAX_LIVE_PREPARES} unexpired, unsubmitted rows.
   */
  async create(payment: NewPreparedPayment, now: Date): Promise<BitcoinPreparedPayment> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1::integer, hashtext($2))', [
        BITCOIN_PREPARE_ADVISORY_LOCK,
        payment.walletAccountId,
      ]);
      const payments = manager.withRepository(this.payments);
      await payments
        .createQueryBuilder()
        .delete()
        .from(BitcoinPreparedPayment)
        .where('expires_at <= :cutoff', { cutoff: new Date(now.getTime() - PREPARE_RETENTION_MS) })
        .execute();
      const live = await payments
        .createQueryBuilder('payment')
        .where('payment.walletAccountId = :walletAccountId', { walletAccountId: payment.walletAccountId })
        .andWhere('payment.submittedAt IS NULL')
        .andWhere('payment.expiresAt > :now', { now })
        .getCount();
      if (live >= MAX_LIVE_PREPARES) {
        throw walletError(429, 'PrepareRateLimited');
      }
      return payments.save(payments.create({ ...payment, submittedAt: null }));
    });
  }

  async find(id: string, walletAccountId: string, blockchain: string): Promise<BitcoinPreparedPayment | null> {
    return this.payments.findOneBy({ id, walletAccountId, blockchain });
  }

  async markSubmitted(id: string, now: Date): Promise<void> {
    await this.payments
      .createQueryBuilder()
      .update(BitcoinPreparedPayment)
      .set({ submittedAt: now })
      .where('id = :id AND submitted_at IS NULL', { id })
      .execute();
  }
}
