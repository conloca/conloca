import { describe, expect, test } from 'bun:test';
import { joinEsm, splitEsm } from '../esm-passthrough.js';

/**
 * `splitEsm`/`joinEsm` keep author `import`/`export` statements out of the MDX
 * editor and put them back verbatim. These exercise the pair directly; the
 * end-to-end proof against the real editor lives in `mdx-esm-fidelity.test.tsx`.
 */
describe('splitEsm / joinEsm', () => {
  test('a leading import survives an untouched body byte for byte', () => {
    // Leading newline and the blank line after the import are both part of the
    // real files: the body handed to the editor starts right after `---\n`.
    const source = "\nimport { Aside } from '@astrojs/starlight/components';\n\n<Aside>hi</Aside>\n";
    const split = splitEsm(source);

    expect(split.prefix).toBe("\nimport { Aside } from '@astrojs/starlight/components';\n\n");
    expect(split.body).toBe('<Aside>hi</Aside>\n');
    expect(split.bindings).toEqual(new Set(['Aside']));
    expect(joinEsm(split, split.body)).toBe(source);
  });

  test('the trailing semicolon and specifier order are preserved exactly', () => {
    // The library's own rebuild emits `import { Aside } from '…'` — no
    // semicolon, specifiers ordered by first reference. Verbatim passthrough is
    // the only thing that reproduces the author's line.
    const source = "import { Steps, Aside, Tabs, TabItem } from '@astrojs/starlight/components';\n\nText\n";
    const split = splitEsm(source);

    expect(split.prefix).toBe("import { Steps, Aside, Tabs, TabItem } from '@astrojs/starlight/components';\n\n");
    expect(joinEsm(split, split.body)).toBe(source);
  });

  test('an import inside a fenced code block is left in the body', () => {
    // A real-world getting-started.mdx embeds an astro.config.mjs sample whose
    // lines start with `import` at column 0. Treating those as ESM would hoist
    // sample code out of the fence and corrupt the document.
    const source = "Prose.\n\n```js\nimport { defineConfig } from 'astro/config';\n```\n";
    const split = splitEsm(source);

    expect(split.prefix).toBe('');
    expect(split.body).toBe(source);
    expect(joinEsm(split, split.body)).toBe(source);
  });

  test('multiple leading statements keep their blank-line layout', () => {
    const source = "import a from 'a';\nimport b from 'b';\n\nimport './side-effect.css';\n\nBody\n";
    const split = splitEsm(source);

    expect(split.prefix).toBe("import a from 'a';\nimport b from 'b';\n\nimport './side-effect.css';\n\n");
    expect(split.body).toBe('Body\n');
    expect(split.bindings).toEqual(new Set(['a', 'b']));
    expect(joinEsm(split, split.body)).toBe(source);
  });

  test('a document with no ESM is handed to the editor untouched', () => {
    const source = '# Title\n\nJust prose, no imports.\n';
    const split = splitEsm(source);

    expect(split.prefix).toBe('');
    expect(split.body).toBe(source);
    // No prefix means join is a pass-through, including for a rewritten body.
    expect(joinEsm(split, 'edited')).toBe('edited');
  });

  test('a mid-document export is hoisted into the preserved block', () => {
    // Position below the first content block is unrecoverable once the body is
    // restructured, and MDX hoists ESM to module scope anyway — so preserve the
    // statement rather than let the editor drop it and break the build.
    const source = "Intro\n\nexport const version = '1.0';\n\nUses {version}\n";
    const split = splitEsm(source);

    expect(split.prefix).toBe("export const version = '1.0';\n\n");
    expect(split.body).not.toContain('export const');
    expect(split.bindings).toEqual(new Set(['version']));
    expect(joinEsm(split, split.body)).toContain("export const version = '1.0';");
  });

  test('a document that is only ESM does not crash and stays stable', () => {
    // Reachable from the editor: select-all + delete empties the body, so the
    // value handed back on the next render is nothing but import statements.
    const source = "import { Aside } from 'x';\n";
    const split = splitEsm(source);

    expect(split.body).toBe('');
    expect(joinEsm(split, '')).toBe(source);
    // Re-splitting what we emitted must reproduce the same prefix.
    expect(splitEsm(joinEsm(split, '')).prefix).toBe(split.prefix);
  });

  test('emptying the body keeps the imports and stays idempotent', () => {
    const source = "\nimport { Aside } from 'x';\n\nContent\n";
    const first = splitEsm(source);

    const emptied = joinEsm(first, '');
    expect(emptied).toBe("\nimport { Aside } from 'x';\n\n");

    const second = splitEsm(emptied);
    expect(second.prefix).toBe(first.prefix);
    expect(second.body).toBe('');
    expect(joinEsm(second, '')).toBe(emptied);
  });

  test('a rebuilt import already covered by the author is dropped', () => {
    // A descriptor carrying `import.from` makes the library emit its own import
    // line. Re-attaching ours on top would declare `Aside` twice and break the
    // build with "Identifier 'Aside' has already been declared".
    const split = splitEsm("import { Aside } from '@astrojs/starlight/components';\n\nBody\n");
    const editorOutput = "import { Aside } from '@astrojs/starlight/components'\n\n<Aside>hi</Aside>";

    expect(joinEsm(split, editorOutput)).toBe(
      "import { Aside } from '@astrojs/starlight/components';\n\n<Aside>hi</Aside>",
    );
  });

  test('a rebuilt import carrying a new binding is narrowed, not dropped', () => {
    const split = splitEsm("import { Aside } from '@astrojs/starlight/components';\n\nBody\n");
    const editorOutput = "import { Aside, Card } from '@astrojs/starlight/components'\n\n<Card />";

    // `Aside` comes from the author's verbatim line; only `Card` is new. The
    // author's block keeps its own trailing blank line, so the rebuilt import
    // lands in a second block rather than editing the preserved bytes.
    expect(joinEsm(split, editorOutput)).toBe(
      "import { Aside } from '@astrojs/starlight/components';\n\n" +
        "import { Card } from '@astrojs/starlight/components'\n\n<Card />",
    );
  });

  test('a rebuilt import from an unrelated module is kept as-is', () => {
    const split = splitEsm("import { Aside } from '@astrojs/starlight/components';\n\nBody\n");
    const editorOutput = "import { Chart } from './charts'\n\n<Chart />";

    expect(joinEsm(split, editorOutput)).toBe(
      "import { Aside } from '@astrojs/starlight/components';\n\n" + "import { Chart } from './charts'\n\n<Chart />",
    );
  });

  test('ESM that acorn cannot parse leaves the document alone', () => {
    // `import type { … }` is a TypeScript form the MDX parser rejects, which
    // also makes the editor fall back to source view. Behaviour is unchanged
    // rather than silently mangled.
    const source = "import type { Config } from './cfg';\n\nProse.\n";
    const split = splitEsm(source);

    expect(split.prefix).toBe('');
    expect(split.body).toBe(source);
  });
});
