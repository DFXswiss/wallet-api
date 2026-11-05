import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const files = [
  'src/migrations/1740000000000-WalletSchema.ts',
  'src/entities/wallet-account.entity.ts',
  'src/entities/passkey-credential.entity.ts',
  'src/entities/passkey-challenge.entity.ts',
  'src/entities/passkey-address.entity.ts',
  'src/entities/passkey-diagnostic.entity.ts',
];

describe('wallet schema safety', () => {
  it('has no unsupported contact or user id columns', () => {
    const forbiddenContact = ['e', 'mail'].join('');
    const forbiddenUserId = ['user', '_id'].join('');
    const forbiddenCamelUserId = ['user', 'Id'].join('');
    for (const file of files) {
      const source = readFileSync(join(root, file), 'utf8');
      expect(source.toLowerCase()).not.toContain(forbiddenContact.toLowerCase());
      expect(source).not.toContain(forbiddenUserId);
      expect(source).not.toContain(forbiddenCamelUserId);
    }
  });

  it('names the WebAuthn handle column user_handle', () => {
    const source = readFileSync(join(root, 'src/migrations/1740000000000-WalletSchema.ts'), 'utf8');
    expect(source).toContain('"user_handle" text NOT NULL');
    expect(source).toContain('"session_valid_after" timestamptz NULL');
  });

  it('creates all service-owned tables', () => {
    const source = readFileSync(join(root, 'src/migrations/1740000000000-WalletSchema.ts'), 'utf8');
    for (const table of [
      'wallet_account',
      'passkey_credential',
      'passkey_challenge',
      'passkey_address',
      'passkey_diagnostic',
    ]) {
      expect(source).toContain(`CREATE TABLE "${table}"`);
    }
  });
});
