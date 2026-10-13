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
  // fc00::/7 — unique local address (ULA). Anchored to the address form, as a
  // bare `fc`/`fd` prefix also matches public domains such as `fdic.gov`.
  if (/^f[cd][0-9a-f]{2}[:%]/.test(lower)) return true;

  return false;
}

/**
 * The dotted-quad address embedded in an IPv4-mapped IPv6 host, or `null`.
 * Both spellings of the tail are read: dotted (`::ffff:127.0.0.1`) and hex
 * (`::ffff:7f00:1`), the latter being what URL parsing canonicalizes to.
 */
function ipv4MappedEmbedded(host: string): string | null {
  if (!host.startsWith('::ffff:')) return null;
  const tail = host.slice('::ffff:'.length);
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(tail)) return tail;
  const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

/**
 * Check if a hostname names a private/reserved destination: a blocked name,
 * or an address in a loopback/link-local/private range. A trailing root-label
 * dot and the IPv6 brackets `URL.hostname` keeps are stripped internally, and
 * an IPv4-mapped IPv6 literal is canonicalized to the address it embeds so the
 * mapped spelling cannot smuggle a private destination past the range tables.
 *
 * Exported so other media import guards can reuse these range tables
 * instead of copying them.
 *
 * @param hostname The hostname to check (bare or bracketed IPv6)
 * @returns true if the hostname points to a private/reserved destination
 */
export function isPrivateFetchHost(hostname: string): boolean {
  // A trailing root-label dot is valid syntax for the same host — `localhost.`
  // resolves identically — so drop it before any table sees the name. Stripped
  // ahead of the brackets, whose closing match is anchored to the end.
  const rooted = hostname.replace(/\.+$/, '');
  // URL.hostname keeps the brackets on an IPv6 literal; strip them here so
  // consumers don't have to (no-op for bare input)
  const bare = rooted.replace(/^\[|\]$/g, '').toLowerCase();

  // Check blocked hostnames
  if (BLOCKED_HOSTNAMES.has(bare)) return true;
  // An IPv4-mapped IPv6 literal reaches the address it embeds, so range-check
  // that address rather than the mapped spelling
  const address = ipv4MappedEmbedded(bare) ?? bare;
  // Check IPv4 private ranges
  if (isPrivateIPv4(address)) return true;
  // Check IPv6 private ranges
  return isPrivateIPv6(address);
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

  if (isPrivateFetchHost(parsed.hostname)) {
    throw new Error('URL points to a private/reserved IP address');
  }

  return parsed;
}
