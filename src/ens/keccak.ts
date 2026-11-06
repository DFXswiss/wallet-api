const MASK = (1n << 64n) - 1n;

const ROUND_CONSTANTS = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
];

const ROTATION_OFFSETS = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

function rotateLeft(value: bigint, offset: number): bigint {
  if (offset === 0) {
    return value;
  }
  const shift = BigInt(offset);
  return ((value << shift) | (value >> (64n - shift))) & MASK;
}

function permute(state: bigint[]): void {
  const columns = new Array<bigint>(5);
  const deltas = new Array<bigint>(5);
  const rotated = new Array<bigint>(25);
  for (let round = 0; round < 24; round += 1) {
    for (let x = 0; x < 5; x += 1) {
      columns[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      deltas[x] = columns[(x + 4) % 5] ^ rotateLeft(columns[(x + 1) % 5], 1);
    }
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        state[x + 5 * y] = (state[x + 5 * y] ^ deltas[x]) & MASK;
      }
    }
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        rotated[y + 5 * ((2 * x + 3 * y) % 5)] = rotateLeft(state[x + 5 * y], ROTATION_OFFSETS[x + 5 * y]);
      }
    }
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        state[x + 5 * y] =
          rotated[x + 5 * y] ^ (~rotated[((x + 1) % 5) + 5 * y] & MASK & rotated[((x + 2) % 5) + 5 * y]);
      }
    }
    state[0] = (state[0] ^ ROUND_CONSTANTS[round]) & MASK;
  }
}

export function keccak256(input: Uint8Array): Buffer {
  const rate = 136;
  const paddedLength = Math.ceil((input.length + 1) / rate) * rate;
  const padded = Buffer.alloc(paddedLength);
  Buffer.from(input).copy(padded);
  padded[input.length] ^= 0x01;
  padded[paddedLength - 1] ^= 0x80;

  const state = new Array<bigint>(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let lane = 0; lane < rate / 8; lane += 1) {
      let value = 0n;
      for (let byte = 0; byte < 8; byte += 1) {
        value |= BigInt(padded[offset + lane * 8 + byte]) << BigInt(byte * 8);
      }
      state[lane] = (state[lane] ^ value) & MASK;
    }
    permute(state);
  }

  const output = Buffer.alloc(32);
  for (let lane = 0; lane < 4; lane += 1) {
    let value = state[lane];
    for (let byte = 0; byte < 8; byte += 1) {
      output[lane * 8 + byte] = Number(value & 0xffn);
      value >>= 8n;
    }
  }
  return output;
}

export function namehash(name: string): string {
  let node: Buffer = Buffer.alloc(32);
  if (name.length === 0) {
    return node.toString('hex');
  }
  const labels: string[] = [];
  let rest = name.toLowerCase();
  while (rest.length > 0) {
    const dot = rest.indexOf('.');
    if (dot === -1) {
      labels.push(rest);
      break;
    }
    labels.push(rest.slice(0, dot));
    rest = rest.slice(dot + 1);
    if (rest.length === 0) {
      break;
    }
  }
  for (const label of labels.reverse()) {
    const labelHash = keccak256(Buffer.from(label, 'utf8'));
    node = Buffer.from(keccak256(Buffer.concat([node, labelHash])));
  }
  return node.toString('hex');
}
