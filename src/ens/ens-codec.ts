import { keccak256 } from './keccak';

export const ENS_REGISTRY_ADDRESS = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';

export function functionSelector(signature: string): string {
  return keccak256(Buffer.from(signature, 'utf8')).toString('hex').slice(0, 8);
}

function encodeNodeCall(signature: string, node: string): string {
  const normalized = node.replace(/^0x/, '').padStart(64, '0');
  return `${functionSelector(signature)}${normalized}`;
}

export function encodeRegistryResolverCall(node: string): string {
  return encodeNodeCall('resolver(bytes32)', node);
}

export function encodeResolverAddressCall(node: string): string {
  return encodeNodeCall('addr(bytes32)', node);
}

export function encodeResolverNameCall(node: string): string {
  return encodeNodeCall('name(bytes32)', node);
}

export function rpcResult(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const result = (value as { result?: unknown }).result;
  if (typeof result !== 'string' || !/^0x[0-9a-f]*$/i.test(result) || result.length <= 2) {
    return null;
  }
  return result.slice(2).toLowerCase();
}

export function decodeAddressReturn(value: unknown): string | null {
  const raw = rpcResult(value);
  if (!raw || raw.length < 64) {
    return null;
  }
  const addressWord = raw.slice(0, 64);
  if (/^0+$/.test(addressWord)) {
    return null;
  }
  return `0x${addressWord.slice(24)}`;
}

export function decodeStringReturn(value: unknown): string | null {
  const raw = rpcResult(value);
  if (!raw) {
    return null;
  }
  try {
    const bytes = Buffer.from(raw, 'hex');
    if (bytes.length < 64) {
      return null;
    }
    const offset = readUint256Word(bytes, 0);
    if (offset === null || offset > bytes.length - 32) {
      return null;
    }
    const length = readUint256Word(bytes, offset);
    if (length === null || length === 0 || length > bytes.length - offset - 32) {
      return null;
    }
    return bytes.subarray(offset + 32, offset + 32 + length).toString('utf8');
  } catch {
    return null;
  }
}

function readUint256Word(bytes: Buffer, start: number): number | null {
  if (!Number.isSafeInteger(start) || start < 0 || start > bytes.length - 32) {
    return null;
  }
  for (let index = start; index < start + 24; index += 1) {
    if (bytes[index] !== 0) {
      return null;
    }
  }
  const value = bytes.readBigUInt64BE(start + 24);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}
