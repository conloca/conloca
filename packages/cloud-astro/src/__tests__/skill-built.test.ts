import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The development export condition hides this from every other test: in-repo imports resolve to src/, while a
// site's build runs dist/. The template must be reachable from the built module, or scaffolding silently no-ops.
describe('skillTemplateUrl from the built package', () => {
  it('points at a file that exists', async () => {
    const built = pathToFileURL(join(import.meta.dir, '..', '..', 'dist', 'src', 'skill.js')).href;
    const mod = (await import(built)) as { skillTemplateUrl: () => URL };
    expect(existsSync(fileURLToPath(mod.skillTemplateUrl()))).toBe(true);
  });
});
