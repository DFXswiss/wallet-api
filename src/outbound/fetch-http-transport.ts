import { Injectable } from '@nestjs/common';
import { IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { HttpTransport, OutboundRequest, OutboundResponse } from './http-transport';
import { createPinnedLookup } from './pinned-lookup';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

@Injectable()
export class FetchHttpTransport implements HttpTransport {
  async request(request: OutboundRequest): Promise<OutboundResponse> {
    if (request.pinAddresses !== undefined) {
      return this.requestPinned(request);
    }
    const response = await fetch(request.url, {
      method: request.method ?? 'GET',
      headers: request.headers,
      body: requestBody(request.body),
      redirect: 'manual',
      signal: AbortSignal.timeout(request.timeoutMs ?? 5000),
    });
    const maxBytes = request.maxBytes ?? DEFAULT_MAX_BYTES;
    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > maxBytes) {
      throw new Error('Outbound response is too large');
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new Error('Outbound response is too large');
        }
        chunks.push(value);
      }
    }
    const buffer = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: buffer,
    };
  }

  private requestPinned(request: OutboundRequest): Promise<OutboundResponse> {
    const url = new URL(request.url);
    const hostname = hostnameWithoutBrackets(url.hostname);
    const lookup = createPinnedLookup(request.pinAddresses ?? []);
    const maxBytes = request.maxBytes ?? DEFAULT_MAX_BYTES;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers ?? {})) {
      if (key.toLowerCase() !== 'host') {
        headers[key] = value;
      }
    }
    headers.host = requestHost(url.hostname, url.port);

    return new Promise((resolve, reject) => {
      const outgoing = httpsRequest(
        {
          host: hostname,
          port: url.port || 443,
          path: `${url.pathname}${url.search}`,
          method: request.method ?? 'GET',
          headers,
          servername: hostname,
          lookup,
          signal: AbortSignal.timeout(request.timeoutMs ?? 5000),
        },
        (response) => {
          const contentLength = Number(headerValue(response.headers['content-length']) || '0');
          if (contentLength > maxBytes) {
            response.destroy();
            reject(new Error('Outbound response is too large'));
            return;
          }
          const chunks: Uint8Array[] = [];
          let totalBytes = 0;
          let tooLarge = false;
          response.on('data', (value: Buffer) => {
            if (tooLarge) {
              return;
            }
            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
              tooLarge = true;
              response.destroy();
              reject(new Error('Outbound response is too large'));
              return;
            }
            chunks.push(value);
          });
          response.on('end', () => {
            if (tooLarge) {
              return;
            }
            const body = new Uint8Array(totalBytes);
            let offset = 0;
            for (const chunk of chunks) {
              body.set(chunk, offset);
              offset += chunk.byteLength;
            }
            resolve({
              status: response.statusCode ?? 0,
              headers: responseHeaders(response.headers),
              body,
            });
          });
          response.on('error', reject);
        },
      );
      outgoing.on('error', reject);
      if (request.body !== undefined) {
        outgoing.write(request.body);
      }
      outgoing.end();
    });
  }
}

function requestBody(body: OutboundRequest['body']): BodyInit | undefined {
  if (body === undefined) {
    return undefined;
  }
  if (typeof body === 'string') {
    return body;
  }
  const copy = new ArrayBuffer(body.byteLength);
  new Uint8Array(copy).set(body);
  return new Uint8Array(copy) as BodyInit;
}

function hostnameWithoutBrackets(hostname: string): string {
  return hostname.replace(/^\[/, '').replace(/\]$/, '');
}

function requestHost(hostname: string, port: string): string {
  return port ? `${hostname}:${port}` : hostname;
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(', ') : (value ?? '');
}

function responseHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      result[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  return result;
}
