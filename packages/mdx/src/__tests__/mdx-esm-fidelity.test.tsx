import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import { cleanup, render, waitFor } from '@testing-library/react';
import matter from 'gray-matter';
import { createRef } from 'react';
import { MDXEditor } from '../index.js';

/**
 * End-to-end fidelity: an author's `.mdx` file must survive a no-op trip through
 * the editor with its `import`/`export` statements byte-identical.
 *
 * This drives the **real** editor — it renders `MDXEditor`, lets the library
 * parse the markdown into Lexical and serialize it back, and reads the result
 * through the public `MDXEditorMethods` ref. That matters: parsing the same
 * fixtures with gfm extensions alone (as `markdown-options.test.ts` does, for
 * its own unrelated purpose) never produces an `mdxjsEsm` node and never treats
 * `<Aside>` as JSX, so it would report a byte-identical pass on precisely the
 * two constructs this test exists to protect.
 *
 * The fixtures are copies of two docs from a real Starlight docs corpus, the
 * one this defect was found on, where 17 of 24 documents carry a component
 * import.
 */

/** Mirrors the frontmatter strip a content host applies before handing the body to the editor. */
function stripFrontmatter(source: string): string {
  if (!source.startsWith('---\n')) return source;
  const end = source.indexOf('\n---\n', 4);
  if (end === -1) return source;
  return source.slice(end + 5);
}

/**
 * The canonical file bytes for an `mdx` envelope, as a content store re-emits
 * them. The frontmatter is server-owned and re-emitted from the envelope, so
 * the body is the only thing the editor contributes.
 */
function serverWrite(original: string, editedBody: string): string {
  const envelope = matter(original, {});
  const frontmatter: Record<string, unknown> = {
    ...envelope.data,
    id: envelope.data.id,
    created: envelope.data.created,
    modified: envelope.data.modified,
  };
  let body: Parameters<typeof matter.stringify>[0];
  try {
    body = matter(editedBody, {});
  } catch {
    body = { content: editedBody };
  }
  return matter.stringify(body, frontmatter);
}

/** Push a markdown body through the editor's parse → serialize round trip. */
async function editorRoundTrip(body: string): Promise<string> {
  const ref = createRef<MDXEditorMethods>();
  const { container } = render(<MDXEditor ref={ref} value={body} onChange={() => {}} />);
  await waitFor(() => {
    expect(container.querySelector('[contenteditable]')).toBeTruthy();
  });
  const editor = ref.current;
  if (editor === null) throw new Error('editor ref was never attached');
  return editor.getMarkdown();
}

/** Every line that is an ESM statement at the start of a line. */
function esmLines(source: string): string[] {
  return source.split('\n').filter((line) => /^(?:import|export)\b/.test(line));
}

function readFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

/**
 * The exact module-scope import each fixture must carry, semicolon included.
 * Pinned here rather than derived from the file: that is what makes the
 * round-trip assertions below mean something.
 */
const FIXTURE_IMPORT: Record<string, string> = {
  'starlight-api-keys.mdx': "import { Aside } from '@astrojs/starlight/components';",
  'starlight-getting-started.mdx': "import { Steps, Aside, Tabs, TabItem } from '@astrojs/starlight/components';",
};

describe('MDX ESM round-trip fidelity', () => {
  afterEach(() => {
    cleanup();
  });

  // A round-trip test is only as strong as its input. If a formatter ever
  // normalizes these fixtures — strips the trailing semicolon, reflows the
  // folded frontmatter scalar — every assertion below would still pass while
  // testing nothing. Fail loudly instead: these fixtures must never be
  // reformatted.
  for (const [name, statement] of Object.entries(FIXTURE_IMPORT)) {
    test(`${name} still carries the constructs under test`, () => {
      const original = readFixture(name);

      // Verbatim, semicolon included. Note this is deliberately not derived
      // from the file: the point is to pin what the file must say.
      expect(original).toContain(`\n${statement}\n`);
      // The JSX those specifiers define must still be in the body, or a dropped
      // import would break nothing and the test would prove nothing.
      expect(original).toContain('<Aside');
      // Note `esmLines` would also pick up the `import` lines inside this file's
      // astro.config.mjs code fence, which is exactly why this pins the one
      // module-scope statement instead.
    });
  }

  for (const name of Object.keys(FIXTURE_IMPORT)) {
    test(`${name} keeps its import statements byte-identical`, async () => {
      const original = readFixture(name);
      const bodyIn = stripFrontmatter(original);

      const bodyOut = await editorRoundTrip(bodyIn);

      // The statements the author wrote, verbatim: same text, same order, same
      // specifiers, same trailing semicolon. The library's own rebuild emits
      // `import { X } from 'y'` with no semicolon and prunes specifiers it did
      // not see referenced, so this is the assertion that fails without the fix.
      expect(esmLines(bodyOut)).toEqual(esmLines(bodyIn));

      // Whole leading region, including the blank lines around the import block.
      const leadingIn = bodyIn.slice(0, bodyIn.indexOf('\n\n', bodyIn.indexOf('import ')) + 2);
      expect(bodyOut.startsWith(leadingIn)).toBe(true);

      // And the file the server would commit still carries the line.
      const written = serverWrite(original, bodyOut);
      for (const statement of esmLines(bodyIn)) {
        expect(written).toContain(statement);
      }
    });
  }

  test('api-keys.mdx round-trips byte-for-byte through the server write path', async () => {
    // This file has no folded frontmatter scalar and no bare URL, so nothing is
    // left to excuse: the committed bytes must be identical.
    const original = readFixture('starlight-api-keys.mdx');
    const written = serverWrite(original, await editorRoundTrip(stripFrontmatter(original)));

    expect(written).toBe(original);
  });

  test('a nested component keeps the specifier that defines it', async () => {
    // The build-breaking case. `<TabItem>` is nested inside `<Tabs>`, so the
    // library registers it by name with no import source and prunes it from the
    // rebuilt line — leaving JSX that Astro cannot resolve.
    const body =
      'import { Tabs, TabItem } from \'@astrojs/starlight/components\';\n\n<Tabs>\n  <TabItem label="npm">\n    hello\n  </TabItem>\n</Tabs>\n';

    const out = await editorRoundTrip(body);

    expect(out).toContain("import { Tabs, TabItem } from '@astrojs/starlight/components';");
    expect(out).toContain('<TabItem');
  });

  test('an export the document references is not dropped', async () => {
    const body = "export const version = '1.0';\n\nUses {version} inline.\n";

    const out = await editorRoundTrip(body);

    expect(out).toContain("export const version = '1.0';");
    expect(out).toContain('{version}');
  });

  test('a side-effect import survives', async () => {
    const body = "import './styles.css';\n\nJust prose.\n";

    expect(await editorRoundTrip(body)).toContain("import './styles.css';");
  });

  test('an import inside a fenced code block is left alone', async () => {
    // getting-started.mdx embeds an astro.config.mjs sample whose lines start
    // with `import` at column 0. Those belong to the fence, not to module scope.
    const body = "Prose.\n\n```js\nimport { defineConfig } from 'astro/config';\n```\n";

    const out = await editorRoundTrip(body);

    expect(out).toContain('```js');
    expect(out.indexOf('import { defineConfig }')).toBeGreaterThan(out.indexOf('```js'));
  });
});
