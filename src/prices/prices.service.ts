import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { walletError } from '../common/wallet-error';
import { SafeFetchService } from '../outbound/safe-fetch.service';
import { parsePriceHosts } from '../proxy/proxy-config';

const PRICE_CACHE_TTL_MS = 60_000;

@Injectable()
export class PricesService {
  private cached: { expiresAt: number; value: unknown } | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly safeFetch: SafeFetchService,
  ) {}

  async prices(): Promise<unknown> {
    const rawUrl = this.config.get<string>('WALLET_PRICE_URL')?.trim();
    if (!rawUrl) {
      throw walletError(503, 'PriceSourceNotConfigured');
    }
    const hosts = new Set(parsePriceHosts(this.config.get<string>('WALLET_PRICE_HOSTS')));
    let source: URL;
    try {
      source = new URL(rawUrl);
    } catch {
      throw walletError(503, 'PriceSourceNotConfigured');
    }
    if (
      source.protocol !== 'https:' ||
      source.username ||
      source.password ||
      !hosts.has(source.hostname.toLowerCase())
    ) {
      throw walletError(503, 'PriceSourceNotConfigured');
    }
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.value;
    }
    const value = await this.safeFetch.fetchJson(source.toString(), { allowedContentTypes: ['application/json'] });
    this.cached = { expiresAt: Date.now() + PRICE_CACHE_TTL_MS, value };
    return value;
  }
}
