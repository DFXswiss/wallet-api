export const HOST_RESOLVER = Symbol('HOST_RESOLVER');

export interface HostResolver {
  resolve(hostname: string): Promise<string[]>;
}
