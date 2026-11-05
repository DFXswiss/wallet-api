import { walletError } from '../common/wallet-error';

const NAME_PATTERN = /^[a-z0-9.-]{1,253}$/i;

export function requireEnsName(name: string | undefined): string {
  if (!name || !NAME_PATTERN.test(name) || name.split('.').some((label) => label.length === 0)) {
    throw walletError(400, 'EnsNameInvalid');
  }
  return name;
}
