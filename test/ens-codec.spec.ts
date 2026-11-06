import { decodeStringReturn } from '../src/ens/ens-codec';

function abiWord(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

describe('ENS response decoding', () => {
  it('decodes an ABI-encoded string', () => {
    const encoded = [abiWord(32n), abiWord(2n), `${Buffer.from('ab', 'utf8').toString('hex')}${'00'.repeat(30)}`].join(
      '',
    );

    expect(decodeStringReturn({ result: `0x${encoded}` })).toBe('ab');
  });

  it('rejects a zero offset word', () => {
    const encoded = [abiWord(0n), abiWord(2n), `${'61'.repeat(2)}${'00'.repeat(30)}`].join('');

    expect(decodeStringReturn({ result: `0x${encoded}` })).toBeNull();
  });
});
