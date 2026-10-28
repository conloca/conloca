/**
 * The public label the exit route answers with: the first 22 characters of
 * unpadded base64url(SHA-256(`repo\nsite\nbranch`)). It names nothing readable,
 * but lets Conloca's probe tell that an address serves previews for this
 * repository, site and branch. WebCrypto, so it runs on workerd and Node alike.
 */
export async function previewLabel(repo: string, siteId: string, branch: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${repo}\n${siteId}\n${branch}`));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 22);
}
