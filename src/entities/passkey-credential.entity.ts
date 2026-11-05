import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { WalletAccount } from './wallet-account.entity';

@Entity('passkey_credential')
export class PasskeyCredential {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'wallet_account_id', type: 'uuid' })
  walletAccountId: string;

  @ManyToOne(() => WalletAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'wallet_account_id' })
  walletAccount: WalletAccount;

  @Column({ name: 'credential_id', type: 'text', unique: true })
  credentialId: string;

  @Column({ name: 'public_key', type: 'text' })
  publicKey: string;

  @Column({ name: 'user_handle', type: 'text' })
  userHandle: string;

  @Column({ name: 'backup_eligible', type: 'boolean', default: false })
  backupEligible: boolean;

  @Column({ name: 'backed_up', type: 'boolean', default: false })
  backedUp: boolean;

  @Column({ name: 'aaguid', type: 'text', nullable: true })
  aaguid: string | null;

  @Column({ name: 'transports', type: 'text', default: '[]' })
  transports: string;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
