import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { previewLabel } from '../preview/label.js';

/** The label worked out with Node's own hashing, independent of the WebCrypto code under test. */
function expectedLabel(repo: string, site: string, branch: string): string {
  return createHash('sha256').update(`${repo}\n${site}\n${branch}`).digest('base64url').slice(0, 22);
}

describe('previewLabel', () => {
  it('is the first 22 characters of base64url(SHA-256(repo\\nsite\\nbranch))', async () => {
    const repo = 'acme/acme-site';
    expect(await previewLabel(repo, 'website', 'main')).toBe(expectedLabel(repo, 'website', 'main'));
    expect(await previewLabel(repo, 'website', 'feature/x')).toBe(expectedLabel(repo, 'website', 'feature/x'));
  });

  it('names a different label for another site of the same repository and branch', async () => {
    expect(await previewLabel('acme/acme-site', 'docs', 'main')).not.toBe(
      await previewLabel('acme/acme-site', 'website', 'main'),
    );
  });
});
