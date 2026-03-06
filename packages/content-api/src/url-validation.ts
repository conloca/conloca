/**
 * URL validation for SSRF prevention in server-side fetch operations.
 * Blocks private/reserved IP addresses and non-http(s) schemes.
 */

const BLOCKED_HOSTNAMES = new Set(['localhost']);

/** Check if an IPv4 address string points to a private/reserved range */
function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;

  const octets = parts.map((p) => Number.parseInt(p, 10));
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return false;

  const [first, second] = octets;

  // 0.x.x.x — unspecified
  if (first === 0) return true;
  // 10.x.x.x — Class A private
  if (first === 10) return true;
  // 127.x.x.x — loopback
  if (first === 127) return true;
  // 169.254.x.x — link-local (cloud metadata endpoint)
  if (first === 169 && second === 254) return true;
  // 172.16.0.0 – 172.31.255.255 — Class B private
  if (first === 172 && second >= 16 && second <= 31) return true;
  // 192.168.x.x — Class C private
  if (first === 192 && second === 168) return true;

  return false;
}

/** Check if an IPv6 address string points to a private/reserved range */
function isPrivateIPv6(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // ::1 — loopback
  if (lower === '::1') return true;
  // :: — unspecified
  if (lower === '::') return true;
  // fe80: — link-local
  if (lower.startsWith('fe80:') || lower.startsWith('fe80%')) return true;
  // fc00:/fd00: — unique local address (ULA)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

  return false;
}

/**
 * Validate that a URL is safe to fetch server-side.
 * Blocks private/reserved IP addresses and non-http(s) schemes.
 *
 * @param url The URL string to validate
 * @returns The parsed URL object if valid
 * @throws Error if the URL is invalid, uses a blocked scheme, or points to a private IP
 */
export function validateFetchUrl(url: string): URL {
  const parsed = new URL(url); // throws on invalid URLs

  // Check scheme
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('URL scheme must be http or https');
  }

  // Extract hostname (strip brackets from IPv6)
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  // Check blocked hostnames
  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
    throw new Error('URL points to a private/reserved IP address');
  }

  // Check IPv4 private ranges
  if (isPrivateIPv4(hostname)) {
    throw new Error('URL points to a private/reserved IP address');
  }

  // Check IPv6 private ranges
  if (isPrivateIPv6(hostname)) {
    throw new Error('URL points to a private/reserved IP address');
  }

  return parsed;
}
