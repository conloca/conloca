/**
 * Cloudflare Access JWT validation utility
 *
 * Validates JWT tokens from CF Access for API authorization and git commit attribution.
 * When CF_ACCESS_TEAM_NAME and CF_ACCESS_AUD env vars are set, requests must have valid tokens.
 * When neither is set (local dev), validation is skipped. When only one is set, every request is
 * refused: Access was meant to be on, and skipping it would leave the CMS open.
 */

import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';

// One JWKS per team, each with jose's built-in caching (handles key rotation automatically).
// The env is read per request so a config change or a test never sees a stale module-load value.
const jwksByTeam = new Map<string, JWTVerifyGetKey>();

function jwksFor(team: string): JWTVerifyGetKey {
  let jwks = jwksByTeam.get(team);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`));
    jwksByTeam.set(team, jwks);
  }
  return jwks;
}

export interface CFAccessUser {
  email?: string;
  sub?: string;
}

export interface CFAccessResult {
  valid: boolean;
  required: boolean;
  user?: CFAccessUser;
  error?: string;
}

/**
 * Extract CF Access JWT token from request.
 * Checks Cf-Access-Jwt-Assertion header first, falls back to CF_Authorization cookie.
 */
export function extractCFAccessToken(request: Request): string | null {
  // Header is primary (always present when behind CF Access)
  const headerToken = request.headers.get('Cf-Access-Jwt-Assertion');
  if (headerToken) return headerToken;

  // Cookie is fallback (browser requests)
  const cookies = request.headers.get('Cookie') || '';
  const match = cookies.match(/CF_Authorization=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Validate CF Access JWT from request.
 *
 * Returns { valid: true, required: false } when neither env var is set (local dev mode).
 * Returns { valid: false, required: true, error } when only one is set (misconfigured: fail closed).
 * Returns { valid: true, required: true, user } when token is valid.
 * Returns { valid: false, required: true, error } when token is invalid or missing.
 */
export async function validateCFAccessRequest(request: Request): Promise<CFAccessResult> {
  // Whitespace-only counts as unset, so a blank line in an env file does not half-configure Access
  const team = process.env.CF_ACCESS_TEAM_NAME?.trim() || undefined;
  const audience = process.env.CF_ACCESS_AUD?.trim() || undefined;
  if (!team && !audience) {
    return { valid: true, required: false };
  }
  if (!team || !audience) {
    return {
      valid: false,
      required: true,
      error: 'CF Access is partially configured: set both CF_ACCESS_TEAM_NAME and CF_ACCESS_AUD, or neither',
    };
  }

  const token = extractCFAccessToken(request);
  if (!token) {
    return { valid: false, required: true, error: 'No token provided' };
  }

  try {
    const { payload } = await jwtVerify(token, jwksFor(team), {
      issuer: `https://${team}.cloudflareaccess.com`,
      audience,
    });

    return {
      valid: true,
      required: true,
      user: {
        email: typeof payload.email === 'string' && payload.email ? payload.email : undefined,
        sub: typeof payload.sub === 'string' && payload.sub ? payload.sub : undefined,
      },
    };
  } catch (error) {
    return {
      valid: false,
      required: true,
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}
