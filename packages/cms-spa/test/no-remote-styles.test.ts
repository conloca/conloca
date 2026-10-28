import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The editor's stylesheet loads in the workspace shell, whose CSP allows only same-origin stylesheets, and in the
// editor page on the site's origin. A remote @import in either is a third-party request the editor never needs: the
// editor sets its own system font stack (--puck-font-family in main.css).

const mainCss = readFileSync(join(import.meta.dir, '../src/main.css'), 'utf8');

describe('the editor stylesheet', () => {
  test('pulls in no remote stylesheet through its package imports', () => {
    const packages = [...mainCss.matchAll(/^@import "([^".][^"]*)"/gm)].map((match) => match[1] ?? '');
    expect(packages).toContain('@puckeditor/core/no-external.css');
    for (const specifier of packages) {
      const css = readFileSync(Bun.resolveSync(specifier, import.meta.dir), 'utf8');
      expect({ specifier, remote: /@import\s+(url\()?["']?https?:/.test(css) }).toEqual({ specifier, remote: false });
    }
  });
});
