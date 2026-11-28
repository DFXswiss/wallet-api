import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IncomingHttpHeaders, request as httpRequest } from 'node:http';
import { AddressInfo } from 'node:net';
import { configureCors, corsOrigins } from '../src/config/cors';
import { WalletEnvironment } from '../src/config/environment';

@Controller('v1/wallet/health')
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

@Module({ controllers: [PingController] })
class PingModule {}

type Answer = { status: number; headers: IncomingHttpHeaders };

function send(port: number, method: string, headers: Record<string, string>): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path: '/v1/wallet/health', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

function preflight(port: number, origin: string): Promise<Answer> {
  return send(port, 'OPTIONS', {
    Origin: origin,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization,content-type',
  });
}

const PRD = 'https://app.dfx.swiss';
const STG = 'https://stg.app.dfx.swiss';
const DEV = 'https://dev.app.dfx.swiss';
const LOCAL = 'http://localhost:3000';
const LOCAL_PASSKEY = 'http://wallet.localhost:5173';

const foreign = ['https://evil.example', 'https://app.dfx.swiss.evil.example', 'http://app.dfx.swiss', 'null'];

const cases: Array<[WalletEnvironment, string | undefined, string[], string[]]> = [
  ['prd', undefined, [PRD], [STG, DEV, LOCAL, ...foreign]],
  ['stg', undefined, [STG], [PRD, DEV, LOCAL, ...foreign]],
  ['dev', undefined, [DEV], [PRD, STG, LOCAL, ...foreign]],
  ['loc', LOCAL_PASSKEY, [LOCAL, LOCAL_PASSKEY], [PRD, STG, DEV, 'http://localhost:3001', ...foreign]],
];

describe('CORS origins', () => {
  it('allows only the environment app origin', () => {
    expect(corsOrigins('prd')).toEqual([PRD]);
    expect(corsOrigins('stg')).toEqual([STG]);
    expect(corsOrigins('dev')).toEqual([DEV]);
    expect(corsOrigins('prd', LOCAL_PASSKEY)).toEqual([PRD]);
    expect(corsOrigins('dev', LOCAL_PASSKEY)).toEqual([DEV]);
  });

  it('adds PASSKEY_ORIGIN on loc only when it is a bare origin', () => {
    expect(corsOrigins('loc')).toEqual([LOCAL]);
    expect(corsOrigins('loc', LOCAL_PASSKEY)).toEqual([LOCAL, LOCAL_PASSKEY]);
    expect(corsOrigins('loc', LOCAL)).toEqual([LOCAL]);
    for (const value of [`${LOCAL_PASSKEY}/`, `${LOCAL_PASSKEY}/app`, 'ftp://wallet.localhost', 'not a url', '']) {
      expect(corsOrigins('loc', value)).toEqual([LOCAL]);
    }
  });
});

describe.each(cases)('CORS preflight on %s', (environment, passkeyOrigin, allowed, refused) => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    app = await NestFactory.create(PingModule, { logger: false });
    configureCors(app, environment, passkeyOrigin);
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(allowed)('allows %s', async (origin) => {
    const answer = await preflight(port, origin);
    expect(answer.status).toBe(204);
    expect(answer.headers['access-control-allow-origin']).toBe(origin);
    expect(answer.headers['access-control-allow-methods']).toBe('GET,POST,PUT');
    expect(answer.headers['access-control-allow-headers']).toBe('Authorization,Content-Type');
    expect(answer.headers['access-control-allow-credentials']).toBeUndefined();
    expect(answer.headers['access-control-max-age']).toBe('600');
    expect(String(answer.headers.vary)).toContain('Origin');

    const simple = await send(port, 'GET', { Origin: origin });
    expect(simple.status).toBe(200);
    expect(simple.headers['access-control-allow-origin']).toBe(origin);
  });

  it.each(refused)('refuses %s', async (origin) => {
    const answer = await preflight(port, origin);
    expect(answer.headers['access-control-allow-origin']).toBeUndefined();
    const simple = await send(port, 'GET', { Origin: origin });
    expect(simple.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('adds no CORS header without an Origin', async () => {
    const answer = await send(port, 'GET', {});
    expect(answer.status).toBe(200);
    expect(answer.headers['access-control-allow-origin']).toBeUndefined();
  });
});
