import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { WalletAccount } from './wallet-account.entity';

@Entity('passkey_diagnostic')
export class PasskeyDiagnostic {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'wallet_account_id', type: 'uuid', nullable: true })
  walletAccountId: string | null;

  @ManyToOne(() => WalletAccount, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'wallet_account_id' })
  walletAccount: WalletAccount | null;

  @Column({ name: 'payload', type: 'jsonb' })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
