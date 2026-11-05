import { EnsService } from '../src/ens/ens.service';
import {
  ENS_REGISTRY_ADDRESS,
  encodeRegistryResolverCall,
  encodeResolverAddressCall,
  encodeResolverNameCall,
} from '../src/ens/ens-codec';

const ALICE = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const RESOLVER = '0x3333333333333333333333333333333333333333';

function addressWord(address: string): { result: string } {
  return { result: `0x${address.slice(2).toLowerCase().padStart(64, '0')}` };
}

function abiString(value: string): { result: string } {
  const body = Buffer.from(value, 'utf8').toString('hex').padEnd(64, '0');
  const length = value.length.toString(16).padStart(64, '0');
  const offset = '20'.padStart(64, '0');
  return { result: `0x${offset}${length}${body}` };
}

function selector(encoded: string): string {
  return encoded.slice(0, 8);
}

describe('ENS reverse resolution', () => {
  const registrySelector = selector(encodeRegistryResolverCall('0'.repeat(64)));
  const nameSelector = selector(encodeResolverNameCall('0'.repeat(64)));
  const addressSelector = selector(encodeResolverAddressCall('0'.repeat(64)));

  function serviceFor(name: string, forward: string) {
    const ethereumEthCall = jest.fn(async (_to: string, data: string) => {
      const call = data.replace(/^0x/, '');
      if (call.startsWith(registrySelector)) {
        return addressWord(RESOLVER);
      }
      if (call.startsWith(nameSelector)) {
        return abiString(name);
      }
      if (call.startsWith(addressSelector)) {
        return addressWord(forward);
      }
      throw new Error(`unexpected call ${call.slice(0, 8)}`);
    });
    const proxy = {
      ethereumRpc: 'https://rpc.example',
      ethereumEthCall,
    };
    return { service: new EnsService(proxy as never), ethereumEthCall };
  }

  it('returns a reverse name only when forward resolution matches', async () => {
    const { service, ethereumEthCall } = serviceFor('alice.eth', ALICE);

    await expect(service.name(ALICE)).resolves.toEqual({ name: 'alice.eth' });
    expect(ethereumEthCall).toHaveBeenCalledWith(ENS_REGISTRY_ADDRESS, expect.any(String));
  });

  it('returns null when the reverse name points somewhere else', async () => {
    const { service } = serviceFor('alice.eth', OTHER);

    await expect(service.name(ALICE)).resolves.toEqual({ name: null });
  });

  it('returns null for a reverse name with an empty label', async () => {
    const { service, ethereumEthCall } = serviceFor('.alice.eth', ALICE);

    await expect(service.name(ALICE)).resolves.toEqual({ name: null });
    const selectors = ethereumEthCall.mock.calls.map((call) => String(call[1]).replace(/^0x/, '').slice(0, 8));
    expect(selectors).not.toContain(addressSelector);
  });
});
