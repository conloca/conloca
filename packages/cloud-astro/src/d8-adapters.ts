/** The adapter releases draft preview is tested with; `conloca connect` installs exactly these (a test keeps them equal). */
export const D8_TESTED_ADAPTERS = {
  '@astrojs/vercel': '11.0.18',
  '@astrojs/netlify': '8.2.11',
  '@astrojs/cloudflare': '14.3.2',
  '@astrojs/node': '11.1.9',
} as const;

/** The host rate-limit rule for the preview route under `prefix`, as connect prints it and doctor names it. */
export function d8RateLimitLines(adapter: string, prefix: string): string[] {
  if (adapter === '@astrojs/vercel') {
    return [
      `Firewall → Add rule → If Request Path starts with ${prefix}/ → Rate Limit, 60 requests per 10 seconds per IP → Deny`,
    ];
  }
  if (adapter === '@astrojs/netlify')
    return [`Rate limiting rule: path ${prefix}/*, 60 requests per 60 seconds per IP`];
  return [];
}
