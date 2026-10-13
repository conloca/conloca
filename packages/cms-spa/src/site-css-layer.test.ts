import { describe, expect, test } from 'bun:test';
import { wrapSiteCSS } from './site-css-layer.js';

/** Everything between the layer's opening brace and the final `}`. */
function layerBody(wrapped: string): string {
  const open = wrapped.indexOf('@layer conloca-site {');
  return wrapped.slice(open + '@layer conloca-site {'.length, wrapped.lastIndexOf('}'));
}

/** Everything before the layer declaration — the hoisted preamble. */
function preamble(wrapped: string): string {
  return wrapped.slice(0, wrapped.indexOf('@layer conloca-site;'));
}

describe('wrapSiteCSS', () => {
  test('re-homes ordinary rules inside the conloca-site layer', () => {
    const wrapped = wrapSiteCSS('.hero{color:red}');
    expect(wrapped).toContain('@layer conloca-site;');
    expect(layerBody(wrapped)).toContain('.hero{color:red}');
  });

  test('hoists @import in the url() shape', () => {
    const css = '@import url("https://fonts.example/css2?family=Inter:wght@400;700&display=swap");.hero{color:red}';
    const wrapped = wrapSiteCSS(css);
    // The whole statement survives — the `;` inside the query string must not
    // truncate it, or the browser sees a malformed import and a stray tail.
    expect(preamble(wrapped)).toContain(
      '@import url("https://fonts.example/css2?family=Inter:wght@400;700&display=swap");',
    );
    expect(layerBody(wrapped)).not.toContain('@import');
  });

  test('hoists @import in the bare-string shape a minifier emits', () => {
    // REGRESSION: the original regex matched only `url(...)`, so this stayed
    // inside the layer and was dropped — the canvas lost its webfont while
    // every byte arrived intact. Minified builds emit this shape.
    const css = '@import"https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap";.hero{color:red}';
    const wrapped = wrapSiteCSS(css);
    expect(preamble(wrapped)).toContain(
      '@import"https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap";',
    );
    expect(layerBody(wrapped)).not.toContain('@import');
  });

  test('hoists @property out of the layer', () => {
    // REGRESSION: `@property` is invalid inside `@layer` and browsers drop it.
    // Tailwind v4 registers every `--tw-*` custom property this way, so leaving
    // them inside made utilities that read them compute to nothing.
    const css = '@property --tw-gradient-from{syntax:"<color>";inherits:false;initial-value:#0000}.hero{color:red}';
    const wrapped = wrapSiteCSS(css);
    expect(preamble(wrapped)).toContain('@property --tw-gradient-from');
    expect(layerBody(wrapped)).not.toContain('@property');
    expect(layerBody(wrapped)).toContain('.hero{color:red}');
  });

  test('hoists every @property, not just the first', () => {
    const css =
      '@property --a{syntax:"*";inherits:false}.x{color:red}@property --b{syntax:"*";inherits:false}.y{color:blue}';
    const wrapped = wrapSiteCSS(css);
    expect(preamble(wrapped)).toContain('--a');
    expect(preamble(wrapped)).toContain('--b');
    const body = layerBody(wrapped);
    expect(body).not.toContain('@property');
    expect(body).toContain('.x{color:red}');
    expect(body).toContain('.y{color:blue}');
  });

  test('brace-matches @property so a `}` inside a syntax string cannot truncate it', () => {
    const atRule = '@property --edge{syntax:"<length> | }";inherits:false}';
    const wrapped = wrapSiteCSS(`${atRule}.hero{color:red}`);
    // Equality, NOT `toContain`. A brace count that ignores string literals
    // closes on the `}` inside `syntax:"<length> | }"`, hoisting the rule
    // truncated mid-string and stranding `";inherits:false}` at the head of
    // the layer body. That corrupt output still satisfies
    // `preamble contains '@property --edge'` and `body contains '.hero{…}'`,
    // so substring assertions pass against the exact defect they claim to
    // defend. The at-rule must survive verbatim and the body must hold the
    // following rule and nothing else.
    expect(preamble(wrapped).trim()).toBe(atRule);
    expect(layerBody(wrapped)).toBe('\n.hero{color:red}\n');
  });

  test('treats an escaped quote inside a syntax string as data, not a delimiter', () => {
    // Guards the backslash branch of the scanner: without it the closing
    // delimiter is read as still-open, the scan runs to EOF, and the whole
    // remainder of the stylesheet is swallowed as an unbalanced tail.
    const atRule = '@property --esc{syntax:"\\" }";inherits:false}';
    const wrapped = wrapSiteCSS(`${atRule}.hero{color:red}`);
    expect(preamble(wrapped).trim()).toBe(atRule);
    expect(layerBody(wrapped)).toBe('\n.hero{color:red}\n');
  });

  test('handles a single-quoted syntax string too', () => {
    // Generated CSS is not consistently double-quoted, so the scanner must
    // treat `'` as a delimiter as well — otherwise the `}` inside this string
    // truncates exactly as the double-quoted case did.
    const atRule = "@property --sq{syntax:'<length> | }';inherits:false}";
    const wrapped = wrapSiteCSS(`${atRule}.hero{color:red}`);
    expect(preamble(wrapped).trim()).toBe(atRule);
    expect(layerBody(wrapped)).toBe('\n.hero{color:red}\n');
  });

  test('leaves an unterminated @property block where it is rather than corrupt the sheet', () => {
    // A truncated artifact must degrade to "unchanged", never to a mangled
    // hoist: the scan hits EOF with the brace depth still open, so the at-rule
    // stays in the body instead of being cut at an arbitrary point.
    const css = '@property --broken{syntax:"<color>";inherits:false';
    expect(layerBody(wrapSiteCSS(css))).toBe(`\n${css}\n`);
  });

  test('leaves a stylesheet with neither construct byte-identical inside the layer', () => {
    const css = '@layer base{a{text-decoration:none}}.btn{padding:1rem}';
    expect(layerBody(wrapSiteCSS(css))).toBe(`\n${css}\n`);
  });
});
