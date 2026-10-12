import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';

export function parseHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split('.').map(Number);
    const [a, b] = octets;
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
      || (a === 192 && b === 88 && octets[2] === 99)
      || (a === 198 && b === 51) || (a === 203 && b === 0));
  }
  if (family === 6) {
    const normalized = (address.split('%')[0] ?? address).toLowerCase();
    const [left = '', right] = normalized.split('::');
    const groups = right === undefined
      ? left.split(':')
      : [...left.split(':').filter(Boolean), ...Array(Math.max(0, 8 - left.split(':').filter(Boolean).length - right.split(':').filter(Boolean).length)).fill('0'), ...right.split(':').filter(Boolean)];
    if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return false;
    const first = Number.parseInt(groups[0], 16);
    const second = Number.parseInt(groups[1], 16);
    // Permit only global-unicast 2000::/3, excluding documentation and special-use blocks.
    return first >= 0x2000 && first <= 0x3fff
      && !(first === 0x2001 && [0, 2, 0x10, 0x20, 0xdb8].includes(second))
      && first !== 0x2002;
  }
  return false;
}

async function resolvePublic(hostname: string) {
  const unwrapped = hostname.replace(/^\[|\]$/g, '');
  if (isIP(unwrapped)) {
    if (!isPublicAddress(unwrapped)) throw new Error('Restricted address.');
    return { address: unwrapped, family: isIP(unwrapped) };
  }
  const addresses = await lookup(unwrapped, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('Restricted address.');
  return addresses[0];
}

function requestOnce(url: URL, address: { address: string; family: number }, signal: AbortSignal): Promise<{ status: number; location?: string }> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      method: 'GET', timeout: 5000, signal, headers: { Range: 'bytes=0-0', 'User-Agent': 'WorshipScheduler-LinkCheck/1.0' },
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      // We only need the response headers. Never buffer the remote body.
      response.destroy();
      resolve({ status, location });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    request.end();
  });
}

/**
 * Resolve and pin every hop so DNS rebinding and redirects cannot reach private
 * networks. Hosts that require cookies or reject a one-byte Range GET cannot be
 * verified here; callers should use a public share URL instead.
 */
export async function verifyReachableHttpUrl(value: string): Promise<boolean> {
  try {
    let current = new URL(value);
    const signal = AbortSignal.timeout(8000);
    for (let redirect = 0; redirect <= 4; redirect += 1) {
      if (!['http:', 'https:'].includes(current.protocol) || current.username || current.password) return false;
      if (current.port && current.port !== (current.protocol === 'https:' ? '443' : '80')) return false;
      const address = await Promise.race([
        resolvePublic(current.hostname),
        new Promise<never>((_, reject) => {
          const timeout = () => reject(new Error('timeout'));
          if (signal.aborted) timeout();
          else signal.addEventListener('abort', timeout, { once: true });
        }),
      ]);
      const result = await requestOnce(current, address, signal);
      if (result.status >= 300 && result.status < 400 && result.location) {
        if (redirect === 4) return false;
        current = new URL(result.location, current);
        continue;
      }
      return result.status >= 200 && result.status < 300;
    }
    return false;
  } catch {
    return false;
  }
}
