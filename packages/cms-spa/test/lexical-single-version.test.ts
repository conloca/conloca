import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Lexical refuses to run two copies of itself on one page: the second
// editor to mount throws "Minified Lexical error #195" and takes the whole
// MDX page editor down with it.
//
// This package imports `lexical` and `@lexical/react` directly (the slash
// menu's typeahead plugin and GenericBlock's node lookup), while
// `@mdxeditor/editor` imports its own. Both land in the same bundle, so the
// two ranges must resolve to one install. They drifted apart once already:
// the MDXEditor 3.55 -> 4.2.3 bump moved its Lexical requirement from
// ^0.35.0 to ^0.48.0 and left this package's direct pins behind.
//
// Resolution is checked rather than the built bundle because it is what the
// bundler itself follows, and it names the offending version pair directly.
const require_ = createRequire(import.meta.url);

function versionOf(specifier: string, from: NodeJS.Require): string {
  const manifest = from.resolve(`${specifier}/package.json`);
  return JSON.parse(readFileSync(manifest, 'utf8')).version;
}

describe('lexical dependency alignment', () => {
  const mdxEditorRequire = createRequire(require_.resolve('@mdxeditor/editor'));

  for (const specifier of ['lexical', '@lexical/react']) {
    test(`${specifier} resolves to one version for this package and @mdxeditor/editor`, () => {
      expect(versionOf(specifier, require_)).toBe(versionOf(specifier, mdxEditorRequire));
    });
  }
});
