import { describe, expect, it } from 'vitest';
import { isPublicAddress, parseHttpUrl } from './urls';

describe('song lineup URL validation', () => {
  it('accepts only well-formed HTTP and HTTPS URLs without credentials', () => {
    expect(parseHttpUrl('https://example.com/song')).toBe('https://example.com/song');
    expect(parseHttpUrl('http://example.com')).toBe('http://example.com/');
    for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', 'ftp://example.com/song', 'https://user:pass@example.com/song', 'not a url']) {
      expect(parseHttpUrl(url)).toBeNull();
    }
  });

  it('blocks private, loopback, link-local, reserved, and non-global addresses', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '2001:db8::1', '2001:0db8:0:0:0:0:0:1']) {
      expect(isPublicAddress(ip)).toBe(false);
    }
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });
});
