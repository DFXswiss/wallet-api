import { readWalletRuntimeConfig } from '../src/config/environment';

describe('runtime configuration', () => {
  it('fails boot without DATABASE_URL', () => {
    expect(() =>
      readWalletRuntimeConfig({
        ENVIRONMENT: 'loc',
        WALLET_SESSION_SECRET: 'a-session-secret-with-at-least-32-characters',
      }),
    ).toThrow();
  });

  it('fails boot with a short session secret', () => {
    expect(() =>
      readWalletRuntimeConfig({
        ENVIRONMENT: 'loc',
        DATABASE_URL: 'postgres://wallet:wallet@127.0.0.1:5432/wallet',
        WALLET_SESSION_SECRET: 'too-short',
      }),
    ).toThrow();
  });

  it('defaults the port to 3000', () => {
    expect(
      readWalletRuntimeConfig({
        ENVIRONMENT: 'loc',
        DATABASE_URL: 'postgres://wallet:wallet@127.0.0.1:5432/wallet',
        WALLET_SESSION_SECRET: 'a-session-secret-with-at-least-32-characters',
      }).port,
    ).toBe(3000);
  });
});
