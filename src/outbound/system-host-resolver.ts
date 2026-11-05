import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { HostResolver } from './host-resolver';

@Injectable()
export class SystemHostResolver implements HostResolver {
  async resolve(hostname: string): Promise<string[]> {
    const results = await lookup(hostname, { all: true, verbatim: true });
    return results.map((entry) => entry.address);
  }
}
