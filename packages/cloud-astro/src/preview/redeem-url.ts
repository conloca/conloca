/** The org id as unpadded base64url: the form share links, entry codes and the grant cookie carry it in. */
export function orgToken(org: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(org)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

/** `<orgToken>.<grantId>`: names one share link without naming the org in clear. */
export function grantRef(org: string, grantId: string): string {
  return `${orgToken(org)}.${grantId}`;
}

/** A grant reference as the grant cookie holds it. */
export const GRANT_REF_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/u;
