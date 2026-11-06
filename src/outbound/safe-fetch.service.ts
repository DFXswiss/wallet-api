import { Inject, Injectable } from '@nestjs/common';
import { isIP } from 'node:net';
import { walletError } from '../common/wallet-error';
import { HTTP_TRANSPORT, HttpTransport, OutboundResponse } from './http-transport';
import { HOST_RESOLVER, HostResolver } from './host-resolver';
import { isPublicAddress } from './public-address';

export const SAFE_FETCH_TIMEOUT_MS = 5000;
export const SAFE_FETCH_MAX_BYTES = 64 * 1024;
const MAX_REDIRECTS = 3;

export type SafeFetchOptions = {
  maxBytes?: number;
  allowedContentTypes?: string[];
  allowedHosts?: ReadonlySet<string>;
};

type ValidatedRequest = {
  url: URL;
  pinAddresses: string[];
};

@Injectable()
export class SafeFetchService {
  constructor(
    @Inject(HTTP_TRANSPORT) private readonly transport: HttpTransport,
    @Inject(HOST_RESOLVER) private readonly resolver: HostResolver,
  ) {}

  async fetchJson(input: string, options: SafeFetchOptions = {}): Promise<unknown> {
    const response = await this.fetch(input, options);
    if (response.status < 200 || response.status >= 300) {
      throw walletError(502, 'OutboundRequestFailed');
    }
    const contentType = response.headers['content-type'] ?? '';
    if (options.allowedContentTypes && !options.allowedContentTypes.some((type) => contentType.includes(type))) {
      throw walletError(502, 'OutboundRequestFailed');
    }
    try {
      return JSON.parse(Buffer.from(response.body).toString('utf8')) as unknown;
    } catch {
      throw walletError(502, 'OutboundRequestFailed');
    }
  }

  async fetch(input: string, options: SafeFetchOptions = {}): Promise<OutboundResponse> {
    const maxBytes = options.maxBytes ?? SAFE_FETCH_MAX_BYTES;
    let current = input;
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const validated = await this.validateWithPins(urlToValidate(current), options.allowedHosts);
      let response: OutboundResponse;
      try {
        response = await this.transport.request({
          url: validated.url.toString(),
          method: 'GET',
          headers: { accept: 'application/json' },
          timeoutMs: SAFE_FETCH_TIMEOUT_MS,
          maxBytes,
          pinAddresses: validated.pinAddresses,
        });
      } catch {
        throw walletError(502, 'OutboundRequestFailed');
      }
      if (response.body.byteLength > maxBytes) {
        throw walletError(502, 'OutboundRequestFailed');
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location;
        if (!location) {
          throw walletError(502, 'OutboundRequestFailed');
        }
        try {
          current = new URL(location, validated.url).toString();
        } catch {
          throw walletError(400, 'OutboundUrlRefused');
        }
        continue;
      }
      return response;
    }
    throw walletError(502, 'OutboundRequestFailed');
  }

  async validate(input: URL): Promise<URL> {
    return (await this.validateWithPins(input)).url;
  }

  private async validateWithPins(input: URL, allowedHosts?: ReadonlySet<string>): Promise<ValidatedRequest> {
    if (input.protocol !== 'https:') {
      throw walletError(400, 'OutboundUrlRefused');
    }
    if (input.username || input.password) {
      throw walletError(400, 'OutboundUrlRefused');
    }
    const hostname = input.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
    if (allowedHosts && !allowedHosts.has(hostname)) {
      throw walletError(400, 'OutboundUrlRefused');
    }
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
      throw walletError(400, 'OutboundUrlRefused');
    }
    if (isIPAddress(hostname)) {
      if (!isPublicAddress(hostname)) {
        throw walletError(400, 'OutboundUrlRefused');
      }
      return { url: input, pinAddresses: [hostname] };
    }
    let addresses: string[];
    try {
      addresses = await this.resolver.resolve(hostname);
    } catch {
      throw walletError(400, 'OutboundUrlRefused');
    }
    if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
      throw walletError(400, 'OutboundUrlRefused');
    }
    return { url: input, pinAddresses: addresses };
  }
}

function isIPAddress(hostname: string): boolean {
  return isIP(hostname) !== 0;
}

function urlToValidate(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw walletError(400, 'OutboundUrlRefused');
  }
}
