import { Injectable } from '@nestjs/common';
import { walletError } from '../common/wallet-error';
import { SafeFetchService } from '../outbound/safe-fetch.service';

const LIGHTNING_ADDRESS_PATTERN = /^[a-z0-9._+-]{1,128}$/i;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

@Injectable()
export class LnurlService {
  constructor(private readonly safeFetch: SafeFetchService) {}

  async resolve(url: string | undefined): Promise<unknown> {
    if (!url) {
      throw walletError(400, 'OutboundUrlRefused');
    }
    return this.safeFetch.fetchJson(url, { allowedContentTypes: ['application/json'] });
  }

  async lightningAddress(address: string): Promise<unknown> {
    const separator = address.indexOf('@');
    if (separator <= 0 || separator !== address.lastIndexOf('@')) {
      throw walletError(400, 'OutboundUrlRefused');
    }
    const localPart = address.slice(0, separator);
    const domain = address.slice(separator + 1);
    if (!LIGHTNING_ADDRESS_PATTERN.test(localPart) || localPart.includes('/') || !DOMAIN_PATTERN.test(domain)) {
      throw walletError(400, 'OutboundUrlRefused');
    }
    return this.safeFetch.fetchJson(`https://${domain}/.well-known/lnurlp/${localPart}`, {
      allowedContentTypes: ['application/json'],
    });
  }
}
