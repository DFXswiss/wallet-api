import { pinnedTlsTarget } from '../src/outbound/fetch-http-transport';

describe('pinned TLS target', () => {
  it('brackets an IPv6 literal and omits SNI', () => {
    expect(pinnedTlsTarget(new URL('https://[2001:4860:4860::8888]/lnurl'))).toEqual({
      connectHost: '2001:4860:4860::8888',
      hostHeader: '[2001:4860:4860::8888]',
      servername: undefined,
    });
    expect(pinnedTlsTarget(new URL('https://[2001:4860:4860::8888]:8443/lnurl'))).toEqual({
      connectHost: '2001:4860:4860::8888',
      hostHeader: '[2001:4860:4860::8888]:8443',
      servername: undefined,
    });
  });

  it('uses a DNS name as the host header and as SNI', () => {
    expect(pinnedTlsTarget(new URL('https://example.com/path'))).toEqual({
      connectHost: 'example.com',
      hostHeader: 'example.com',
      servername: 'example.com',
    });
    expect(pinnedTlsTarget(new URL('https://example.com:8443/path')).hostHeader).toBe('example.com:8443');
  });

  it('omits SNI for an IPv4 literal', () => {
    expect(pinnedTlsTarget(new URL('https://8.8.8.8/dns'))).toEqual({
      connectHost: '8.8.8.8',
      hostHeader: '8.8.8.8',
      servername: undefined,
    });
  });
});
