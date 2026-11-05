import { isPublicAddress } from '../src/outbound/public-address';

describe('public addresses', () => {
  it('accepts a global address', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2001:4860:4860::8888')).toBe(true);
  });

  it('rejects multicast, 6to4, Teredo, and local NAT64', () => {
    expect(isPublicAddress('224.0.0.1')).toBe(false);
    expect(isPublicAddress('225.0.0.1')).toBe(false);
    expect(isPublicAddress('239.255.255.255')).toBe(false);
    expect(isPublicAddress('2002:7f00:1::')).toBe(false);
    expect(isPublicAddress('2001:0:4136:e378:8000:63bf:3fff:fdd2')).toBe(false);
    expect(isPublicAddress('64:ff9b:1::7f00:1')).toBe(false);
    expect(isPublicAddress('64:ff9b::7f00:1')).toBe(false);
  });
});
