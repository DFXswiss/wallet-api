import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { PasskeyAddress } from './entities/passkey-address.entity';
import { PasskeyChallenge } from './entities/passkey-challenge.entity';
import { PasskeyCredential } from './entities/passkey-credential.entity';
import { PasskeyDiagnostic } from './entities/passkey-diagnostic.entity';
import { WalletAccount } from './entities/wallet-account.entity';
import { WalletSchema1740000000000 } from './migrations/1740000000000-WalletSchema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [WalletAccount, PasskeyCredential, PasskeyChallenge, PasskeyAddress, PasskeyDiagnostic],
  migrations: [WalletSchema1740000000000],
  synchronize: false,
});
