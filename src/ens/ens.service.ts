import { HttpException, Injectable } from '@nestjs/common';
import { walletError } from '../common/wallet-error';
import { ProxyService } from '../proxy/proxy.service';
import {
  ENS_REGISTRY_ADDRESS,
  decodeAddressReturn,
  decodeStringReturn,
  encodeRegistryResolverCall,
  encodeResolverAddressCall,
  encodeResolverNameCall,
} from './ens-codec';
import { requireEnsName } from './ens-name';
import { namehash } from './keccak';

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function requireRpcEnvelope(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw walletError(502, 'OutboundRequestFailed');
  }
  if ('error' in value || !('result' in value)) {
    throw walletError(502, 'OutboundRequestFailed');
  }
  const result = (value as { result?: unknown }).result;
  if (typeof result !== 'string' || !/^0x[0-9a-f]+$/i.test(result)) {
    throw walletError(502, 'OutboundRequestFailed');
  }
  const hex = result.slice(2);
  if (hex.length < 64 || hex.length % 2 !== 0) {
    throw walletError(502, 'OutboundRequestFailed');
  }
  return value;
}

@Injectable()
export class EnsService {
  constructor(private readonly proxy: ProxyService) {}

  async address(name: string | undefined): Promise<{ address: string | null }> {
    this.requireRpc();
    const node = namehash(requireEnsName(name));
    const resolver = await this.resolverFor(node);
    if (!resolver) {
      return { address: null };
    }
    const result = await this.rpc('eth_call', [
      { to: resolver, data: `0x${encodeResolverAddressCall(node)}` },
      'latest',
    ]);
    return { address: decodeAddressReturn(result) };
  }

  async name(address: string | undefined): Promise<{ name: string | null }> {
    this.requireRpc();
    if (!address || !ADDRESS_PATTERN.test(address)) {
      throw walletError(400, 'EnsAddressInvalid');
    }
    const node = namehash(`${address.slice(2).toLowerCase()}.addr.reverse`);
    const resolver = await this.resolverFor(node);
    if (!resolver) {
      return { name: null };
    }
    const resolved = await this.rpc('eth_call', [
      { to: resolver, data: `0x${encodeResolverNameCall(node)}` },
      'latest',
    ]);
    const claimed = decodeStringReturn(resolved);
    if (!claimed || !this.acceptedReverseName(claimed)) {
      return { name: null };
    }
    const forward = await this.address(claimed);
    if (forward.address?.toLowerCase() !== address.toLowerCase()) {
      return { name: null };
    }
    return { name: claimed };
  }

  private acceptedReverseName(name: string): boolean {
    try {
      requireEnsName(name);
      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        return false;
      }
      throw error;
    }
  }

  private requireRpc(): void {
    if (!this.proxy.ethereumRpc) {
      throw walletError(503, 'EnsNotConfigured');
    }
  }

  private async rpc(method: string, params: unknown[]): Promise<unknown> {
    const call = params[0] as { to: string; data: string };
    const value =
      method === 'eth_call'
        ? await this.proxy.ethereumEthCall(call.to, call.data)
        : await this.proxy.evmRpc('1', { jsonrpc: '2.0', id: 1, method, params });
    return requireRpcEnvelope(value);
  }

  private async resolverFor(node: string): Promise<string | null> {
    const result = await this.rpc('eth_call', [
      { to: ENS_REGISTRY_ADDRESS, data: `0x${encodeRegistryResolverCall(node)}` },
      'latest',
    ]);
    return decodeAddressReturn(result);
  }
}
