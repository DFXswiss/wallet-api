import { isIP } from 'node:net';

type PinnedAddress = { address: string; family: number };

export type PinnedLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | PinnedAddress[],
  family?: number,
) => void;

export type PinnedLookupOptions = { all?: boolean } | PinnedLookupCallback;

export function createPinnedLookup(
  pinAddresses: readonly string[],
): (hostname: string, options: PinnedLookupOptions, callback?: PinnedLookupCallback) => void {
  if (pinAddresses.length === 0) {
    throw new Error('At least one pinned address is required');
  }
  const address = pinAddresses[0];
  const family = isIP(address);
  return (_hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    if (!done) {
      throw new Error('A lookup callback is required');
    }
    const lookupOptions: { all?: boolean } = typeof options === 'function' ? {} : options;
    if (lookupOptions.all) {
      done(null, [{ address, family }]);
    } else {
      done(null, address, family);
    }
  };
}
