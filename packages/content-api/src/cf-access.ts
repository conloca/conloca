/**
 * Cloudflare Access JWT validation utility
 *
 * Validates JWT tokens from CF Access for API authorization and git commit attribution.
 * When CF_ACCESS_TEAM_NAME and CF_ACCESS_AUD env vars are set, requests must have valid tokens.
 * When env vars are not set (local dev), validation is skipped.
 */

import { type JWTPayload, createRemoteJWKSet, jwtVerify } from 'jose'

const CF_ACCESS_TEAM_NAME = process.env.CF_ACCESS_TEAM_NAME
const CF_ACCESS_AUD = process.env.CF_ACCESS_AUD

// JWKS with built-in caching (handles key rotation automatically)
const JWKS = CF_ACCESS_TEAM_NAME
  ? createRemoteJWKSet(new URL(`https://${CF_ACCESS_TEAM_NAME}.cloudflareaccess.com/cdn-cgi/access/certs`))
  : null

export interface CFAccessUser {
  email: string
  sub: string
}

export interface CFAccessResult {
  valid: boolean
  required: boolean
  user?: CFAccessUser
  error?: string
}

/**
 * Extract CF Access JWT token from request.
 * Checks Cf-Access-Jwt-Assertion header first, falls back to CF_Authorization cookie.
 */
export function extractCFAccessToken(request: Request): string | null {
  // Header is primary (always present when behind CF Access)
  const headerToken = request.headers.get('Cf-Access-Jwt-Assertion')
  if (headerToken) return headerToken

  // Cookie is fallback (browser requests)
  const cookies = request.headers.get('Cookie') || ''
  const match = cookies.match(/CF_Authorization=([^;]+)/)
  return match ? match[1] : null
}

/**
 * Validate CF Access JWT from request.
 *
 * Returns { valid: true, required: false } when env vars not set (local dev mode).
 * Returns { valid: true, required: true, user } when token is valid.
 * Returns { valid: false, required: true, error } when token is invalid or missing.
 */
export async function validateCFAccessRequest(request: Request): Promise<CFAccessResult> {
  // If CF Access not configured, skip validation (local dev)
  if (!CF_ACCESS_TEAM_NAME || !CF_ACCESS_AUD || !JWKS) {
    return { valid: true, required: false }
  }

  const token = extractCFAccessToken(request)
  if (!token) {
    return { valid: false, required: true, error: 'No token provided' }
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://${CF_ACCESS_TEAM_NAME}.cloudflareaccess.com`,
      audience: CF_ACCESS_AUD,
    })

    return {
      valid: true,
      required: true,
      user: {
        email: (payload as JWTPayload & { email?: string }).email || '',
        sub: payload.sub || '',
      },
    }
  } catch (error) {
    return {
      valid: false,
      required: true,
      error: error instanceof Error ? error.message : 'Validation failed',
    }
  }
}
