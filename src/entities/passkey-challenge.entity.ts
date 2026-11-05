import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { WalletAccount } from './wallet-account.entity';

export type PasskeyChallengePurpose = 'register' | 'authenticate' | 'revoke';

@Entity('passkey_challenge')
export class PasskeyChallenge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'wallet_account_id', type: 'uuid', nullable: true })
  walletAccountId: string | null;

  @ManyToOne(() => WalletAccount, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'wallet_account_id' })
  walletAccount: WalletAccount | null;

  @Column({ name: 'challenge', type: 'text', unique: true })
  challenge: string;

  @Column({ name: 'purpose', type: 'text' })
  purpose: PasskeyChallengePurpose;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;
}
