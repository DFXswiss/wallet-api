import { keccak256, namehash } from '../src/ens/keccak';

describe('Ethereum Keccak', () => {
  it('hashes abc with Keccak padding', () => {
    expect(keccak256(Buffer.from('abc', 'utf8')).toString('hex')).toBe(
      '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
    );
  });

  it('computes the namehash of eth', () => {
    expect(namehash('eth')).toBe('93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae');
  });

  it('hashes an empty label and treats the empty name as the zero node', () => {
    expect(namehash('')).toBe('0'.repeat(64));
    expect(namehash('eth.')).toBe(namehash('eth'));
    const emptyLabel = keccak256(Buffer.alloc(0));
    expect(emptyLabel.toString('hex')).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    const ethNode = Buffer.from(namehash('eth'), 'hex');
    expect(namehash('.eth')).toBe(keccak256(Buffer.concat([ethNode, emptyLabel])).toString('hex'));
    expect(namehash('.eth')).not.toBe(namehash('eth'));
  });
});
