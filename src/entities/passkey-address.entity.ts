import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { WalletAccount } from './wallet-account.entity';

export type WalletChainId = 'bitcoin' | 'ethereum' | 'spark';

@Entity('passkey_address')
@Index('UQ_passkey_address_account_chain', ['walletAccountId', 'chain'], { unique: true })
export class PasskeyAddress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'wallet_account_id', type: 'uuid' })
  walletAccountId: string;

  @ManyToOne(() => WalletAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'wallet_account_id' })
  walletAccount: WalletAccount;

  @Column({ name: 'chain', type: 'text' })
  chain: WalletChainId;

  @Column({ name: 'address', type: 'text' })
  address: string;
}
