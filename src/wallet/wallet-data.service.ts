import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { walletError } from '../common/wallet-error';
import { WalletFamilies, isWalletFamily } from '../config/wallet-families';

const LIST_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

@Injectable()
export class WalletDataService {
  constructor(private readonly families: WalletFamilies) {}

  // Only the chains of a family that is on; an entry without a known family is left out.
  async chains(): Promise<unknown[]> {
    const raw = await readFile(await this.resolveDataFile('chains.json'), 'utf8');
    const chains = JSON.parse(raw) as unknown[];
    return chains.filter((chain) => {
      const family = chain && typeof chain === 'object' ? (chain as { family?: unknown }).family : undefined;
      return isWalletFamily(family) && this.families.isEnabled(family);
    });
  }

  async list(id: string): Promise<unknown> {
    if (!LIST_ID_PATTERN.test(id)) {
      throw walletError(404, 'WalletListNotFound');
    }
    try {
      const raw = await readFile(await this.resolveDataFile('lists', `${id}.json`), 'utf8');
      return JSON.parse(raw) as unknown;
    } catch {
      throw walletError(404, 'WalletListNotFound');
    }
  }

  private async resolveDataFile(...parts: string[]): Promise<string> {
    const candidates = [join(__dirname, 'data', ...parts), join(process.cwd(), 'src', 'wallet', 'data', ...parts)];
    for (const candidate of candidates) {
      try {
        await readFile(candidate, 'utf8');
        return candidate;
      } catch {
        continue;
      }
    }
    throw walletError(404, 'WalletDataNotFound');
  }
}
