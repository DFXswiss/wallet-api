import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { WalletAccount } from './wallet-account.entity';

export type BitcoinPreparedInput = {
  txid: string;
  vout: number;
  value: number;
  address: string;
};

export type BitcoinPreparedOutputKind = 'destination' | 'change';

export type BitcoinPreparedOutput = {
  address: string;
  value: number;
  kind: BitcoinPreparedOutputKind;
};

/**
 * An unsigned Bitcoin payment returned by `prepare`. `submit` accepts only a signed transaction whose txid equals
 * `txid`. For the P2WPKH inputs this service builds, the txid does not cover the witness, so the signed transaction
 * has the same txid as the unsigned one if and only if it spends the same inputs to the same outputs.
 */
@Entity('bitcoin_prepared_payment')
@Index('IDX_bitcoin_prepared_payment_wallet_account', ['walletAccountId'])
@Index('IDX_bitcoin_prepared_payment_expires', ['expiresAt'])
export class BitcoinPreparedPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'wallet_account_id', type: 'uuid' })
  walletAccountId: string;

  @ManyToOne(() => WalletAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'wallet_account_id' })
  walletAccount: WalletAccount;

  @Column({ name: 'blockchain', type: 'text' })
  blockchain: string;

  @Column({ name: 'txid', type: 'text' })
  txid: string;

  @Column({ name: 'psbt', type: 'text' })
  psbt: string;

  @Column({ name: 'inputs', type: 'jsonb' })
  inputs: BitcoinPreparedInput[];

  @Column({ name: 'outputs', type: 'jsonb' })
  outputs: BitcoinPreparedOutput[];

  /** Sats. Postgres `bigint` is returned as a string by the driver. */
  @Column({ name: 'amount', type: 'bigint' })
  amount: string;

  /** Sats. Postgres `bigint` is returned as a string by the driver. */
  @Column({ name: 'fee', type: 'bigint' })
  fee: string;

  /** sat/vB. */
  @Column({ name: 'fee_rate', type: 'integer' })
  feeRate: number;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
