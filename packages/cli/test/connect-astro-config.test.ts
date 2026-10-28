import { describe, expect, test } from 'bun:test';
import { readAstroSite, wireAstroConfig } from '../src/lib/connect/astro-config.js';

const PATH = '/site/astro.config.mjs';

function wire(text: string, repoUri: string | null = 'o/r') {
  return wireAstroConfig({ path: PATH, text, repoUri });
}

/** The single edit's new text; fails when the step edited nothing. */
function output(text: string, repoUri: string | null = 'o/r'): string {
  const result = wire(text, repoUri);
  expect(result.edits).toHaveLength(1);
  return result.edits[0]?.after ?? '';
}

const WIRED = `import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
import { conlocaCloud } from '@conloca/cloud-astro';
import { defineConfig } from 'astro/config';

export default defineConfig({ integrations: [react(), conlocaCMS({}), conlocaCloud({ repoUri: 'o/r' })] });
`;

describe('wireAstroConfig', () => {
  test('adds conlocaCloud after conlocaCMS with its import', () => {
    const text = `import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
import { defineConfig } from 'astro/config';

export default defineConfig({ integrations: [react(), conlocaCMS({})] });
`;
    const result = wire(text);
    expect(result.state).toBe('changed');
    expect(result.edits).toEqual([{ path: PATH, before: text, after: expect.any(String) }]);
    const after = result.edits[0]?.after ?? '';
    expect(after).toContain("conlocaCMS({}), conlocaCloud({ repoUri: 'o/r' })");
    expect(after).toContain("import { conlocaCloud } from '@conloca/cloud-astro';");
  });

  test('adds conlocaCloud on its own line and leaves the rest of a multi-line config as it was', () => {
    const text = `import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [
    // react() first.
    react(),
    conlocaCMS({
      contentRoot: './content',
    }),
  ],
});
`;
    expect(output(text)).toBe(
      text
        .replace("astro/config';\n", "astro/config';\nimport { conlocaCloud } from '@conloca/cloud-astro';\n")
        .replace('    }),\n  ],', "    }),\n    conlocaCloud({ repoUri: 'o/r' }),\n  ],"),
    );
  });

  test('adds conlocaCloud after a last conlocaCMS without a trailing comma', () => {
    const text =
      "import { conlocaCMS } from '@conloca/astro-cms/node';\nimport react from '@astrojs/react';\nexport default {\n  integrations: [\n    react(),\n    conlocaCMS({})\n  ],\n};\n";
    expect(output(text)).toBe(
      text
        .replace("react';\n", "react';\nimport { conlocaCloud } from '@conloca/cloud-astro';\n")
        .replace('conlocaCMS({})\n', "conlocaCMS({}),\n    conlocaCloud({ repoUri: 'o/r' })\n"),
    );
  });

  test('adds the import after a last import that follows the integrations list', () => {
    const text =
      "import react from '@astrojs/react';\nimport { conlocaCMS } from '@conloca/astro-cms/node';\nexport default defineConfig({ integrations: [react(), conlocaCMS({})] });\nimport { defineConfig } from 'astro/config';\n";
    expect(output(text)).toBe(
      text
        .replace('conlocaCMS({})]', "conlocaCMS({}), conlocaCloud({ repoUri: 'o/r' })]")
        .replace("astro/config';\n", "astro/config';\nimport { conlocaCloud } from '@conloca/cloud-astro';\n"),
    );
  });

  test('writes repoUri into conlocaCloud() and leaves every other byte', () => {
    const text = WIRED.replace("conlocaCloud({ repoUri: 'o/r' })", 'conlocaCloud()');
    expect(output(text)).toBe(WIRED);
  });

  test('writes a bare conlocaCloud() when the repository is unknown', () => {
    const after = output(
      `import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
export default defineConfig({ integrations: [react(), conlocaCMS({})] });
`,
      null,
    );
    expect(after).toContain('conlocaCMS({}), conlocaCloud()]');
  });

  test('moves react() before conlocaCMS()', () => {
    const after = output(`import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
export default defineConfig({ integrations: [conlocaCMS({}), react()] });
`);
    expect(after).toContain("[react(), conlocaCMS({}), conlocaCloud({ repoUri: 'o/r' })]");
  });

  test('wires every integration and import into a config with none', () => {
    const after = output(`// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({});
`);
    expect(after).toContain("import react from '@astrojs/react';");
    expect(after).toContain("import { conlocaCMS } from '@conloca/astro-cms/node';");
    expect(after).toContain("import { conlocaCloud } from '@conloca/cloud-astro';");
    const integrations = after.slice(after.indexOf('integrations'));
    expect(integrations.indexOf('react()')).toBeLessThan(integrations.indexOf('conlocaCMS('));
    expect(integrations.indexOf('conlocaCMS(')).toBeLessThan(integrations.indexOf('conlocaCloud('));
    expect(after).toContain("contentRoot: './content'");
  });

  test('reports done and returns the text unchanged when already wired', () => {
    expect(wire(WIRED)).toMatchObject({ state: 'done', edits: [] });
  });

  test('keeps conlocaCloud with its own options and reports differs', () => {
    const text = WIRED.replace(
      "conlocaCloud({ repoUri: 'o/r' })",
      "conlocaCloud({ endpoint: 'https://app.example.com' })",
    );
    expect(wire(text)).toMatchObject({ state: 'differs', edits: [] });
  });

  test('keeps a different repoUri and reports differs', () => {
    expect(wire(WIRED, 'other/repo')).toMatchObject({ state: 'differs', edits: [] });
  });

  test('writes repoUri into a bare conlocaCloud()', () => {
    const after = output(WIRED.replace("conlocaCloud({ repoUri: 'o/r' })", 'conlocaCloud()'));
    expect(after).toContain("conlocaCloud({ repoUri: 'o/r' })");
  });

  test('deletes buildToken, publicBaseUrl, previewDomain, requireRegistration from conlocaCloud', () => {
    const text = WIRED.replace(
      "conlocaCloud({ repoUri: 'o/r' })",
      `conlocaCloud({
      buildToken: process.env.CONLOCA_BUILD_TOKEN,
      publicBaseUrl: 'https://www.example.com',
      previewDomain: 'preview.example.com',
      requireRegistration: true,
      editorBundlePlugins: [],
      fragmentPreviewRoute: '/x',
    })`,
    );
    const result = wire(text);
    expect(result.state).toBe('changed');
    const after = result.edits[0]?.after ?? '';
    for (const key of [
      'buildToken',
      'publicBaseUrl',
      'previewDomain',
      'requireRegistration',
      'editorBundlePlugins',
      'fragmentPreviewRoute',
    ]) {
      expect(after).not.toContain(key);
    }
    expect(after).toContain("conlocaCloud({ repoUri: 'o/r' })");
  });

  test('deletes the removed options and keeps the site owner’s own', () => {
    const text = WIRED.replace(
      "conlocaCloud({ repoUri: 'o/r' })",
      "conlocaCloud({ buildToken: process.env.CONLOCA_BUILD_TOKEN, endpoint: 'https://app.example.com' })",
    );
    const result = wire(text);
    expect(result.state).toBe('changed');
    const after = result.edits[0]?.after ?? '';
    expect(after).not.toContain('buildToken');
    expect(after).toContain("endpoint: 'https://app.example.com'");
    expect(after).not.toContain('repoUri');
  });

  test('prints the lines and edits nothing for a config built by a function', () => {
    const result = wire(`import { defineConfig } from 'astro/config';
export default defineConfig(makeConfig());
`);
    expect(result.state).toBe('needs-you');
    expect(result.edits).toEqual([]);
    expect(result.lines?.length).toBeGreaterThan(0);
    expect(result.lines?.join('\n')).toContain("conlocaCloud({ repoUri: 'o/r' })");
  });

  test('prints the lines and edits nothing for a spread in integrations', () => {
    const result = wire(`export default defineConfig({ integrations: [react(), ...extra] });
`);
    expect(result).toMatchObject({ state: 'needs-you', edits: [] });
  });

  test('never adds an adapter or output', () => {
    const after = output(`import { defineConfig } from 'astro/config';
export default defineConfig({ site: 'https://www.example.com' });
`);
    expect(after).not.toContain('adapter');
    expect(after).not.toContain('output');
  });

  test('reports done when fed its own output, which keeps the final newline', () => {
    for (const text of [
      "import { defineConfig } from 'astro/config';\nexport default defineConfig({});\n",
      WIRED.replace("conlocaCloud({ repoUri: 'o/r' })", 'conlocaCloud()'),
    ]) {
      const after = output(text);
      expect(after).toEndWith(';\n');
      expect(wire(after)).toMatchObject({ state: 'done', edits: [] });
    }
  });

  test('prints the lines and adds no second call for an integration held in a variable', () => {
    const result = wire(`import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
const cms = conlocaCMS({});
export default defineConfig({ integrations: [react(), cms] });
`);
    expect(result).toMatchObject({ state: 'needs-you', edits: [] });
  });

  test('prints the lines and adds no second call for a conditional integration', () => {
    const result = wire(
      WIRED.replace("conlocaCloud({ repoUri: 'o/r' })", "process.env.CI ? conlocaCloud({ repoUri: 'o/r' }) : null"),
    );
    expect(result).toMatchObject({ state: 'needs-you', edits: [] });
  });
});

describe('readAstroSite', () => {
  test('reads a literal site and base', () => {
    expect(readAstroSite(`export default defineConfig({ site: 'https://www.example.com', base: '/docs' });`)).toEqual({
      site: 'https://www.example.com',
      base: '/docs',
    });
  });

  test('reads null for an absent site and base', () => {
    expect(readAstroSite('export default defineConfig({});')).toEqual({ site: null, base: null });
  });

  test('reports a site from the environment as computed', () => {
    expect(readAstroSite('export default defineConfig({ site: process.env.SITE });')).toBe('computed');
  });
});
