import type { SiteStyles } from './site-styles.js';

/**
 * The fallback styles tier for the MDX typing surface, used when no dev-server
 * discovery endpoint answers (a production build). Derived from the siteStyles
 * registry (the `siteStyles` option's CSS), reduced to prose-safe rules, plus
 * a paper base sheet. Lives in cms-spa so every setup runs one derivation.
 *
 * CMSMDXEditor consumes it as the fallback below endpoint discovery: when the
 * `/api/styles` fetch delivers (dev server), this tier stays out of the
 * way entirely — including the paper, so discovery-styled editors keep their
 * host-painted surface.
 */

/**
 * Base sheet appended AFTER the filtered prose rules.
 *
 * The surface underneath the text follows the HOST page, not the admin theme.
 * `useInjectHostStyles` bridges the host's own `body` background and ink onto
 * `:root` as `--conloca-host-prose-bg` / `--conloca-host-color` once the
 * layered host tier has landed. Hard-coding `#ffffff` here is what put
 * `rgb(248, 250, 252)` Starlight headings on a white card — white-on-white —
 * so the paper is now only the FALLBACK, for hosts whose background the
 * bridge could not establish.
 *
 * Ink and paper are a matched pair in both directions: `#181818` on `#ffffff`
 * is the platform pairing, and the bridge only ever publishes the host's
 * background together with the host's ink (as inline custom properties on
 * `<html>`, which outrank these rules). So the surface is either wholly the
 * host's or wholly the platform's, never a light card carrying light text.
 *
 * The ink is a floor, not a verdict: editor-styles.css consumes
 * `--conloca-host-color` as the contenteditable's INHERITED color only, so
 * per-tag host rules kept by the filter still override it.
 *
 * `color-scheme` is deliberately NOT pinned here. It used to be forced to
 * `light` because the paper was always a white card; now that the paper
 * follows the host, forcing a scheme would put light form controls and
 * scrollbars on a dark page. Inheriting it lets the admin theme's
 * `color-scheme` (see `main.css`) reach the surface, which is the scheme the
 * surrounding chrome is already using.
 */
export const PROSE_SURFACE_BASE_CSS = `
:root {
  --conloca-host-color: #181818;
}
.conloca-prose--editor {
  background: var(--conloca-host-prose-bg, #ffffff);
}
`.trim();

/**
 * Derive the tier from the current siteStyles registry content: filtered
 * prose rules first, paper base last (platform floor wins ties). Empty
 * registry → empty tier — the surface keeps its defaults and, deliberately,
 * gets no paper: painting a white card while delivering zero host rules
 * would change dev-server editor surfaces that never had this tier.
 *
 * `hostWrapperClass` is the discovered content-wrapper `class` attribute
 * (`hostWrappers.content.className`, eg `sl-markdown-content`). Real host
 * sheets scope their prose to that class and never to `.conloca-prose`, so
 * without it this tier filters down to nothing — see `filterProseSurfaceCss`.
 */
export function deriveProseSurfaceStyles(siteStyles: SiteStyles, hostWrapperClass?: string | null): SiteStyles {
  if (siteStyles.length === 0) return [];
  return [filterProseSurfaceCss(siteStyles.join('\n'), hostWrapperClass), PROSE_SURFACE_BASE_CSS];
}

/**
 * Reduce a site stylesheet to what the MDX typing surface may safely
 * receive: rules ROOTED AT one of the surface's scope classes, plus
 * `@font-face` blocks.
 *
 * Two scope classes, because there are two ways prose gets scoped:
 *
 *   - `.conloca-prose` — Conloca's documented prose class, carried by the
 *     contenteditable itself. What a host writes when it targets the CMS.
 *   - the DISCOVERED content-wrapper class (`hostWrapperClass`, eg
 *     `sl-markdown-content`) — what a host's own theme actually writes.
 *     `hostWrapperPlugin` renders a clone of that wrapper around the
 *     contenteditable, so these selectors match inside the editor exactly
 *     as they do on the published page.
 *
 * The second one is why this tier existed but did nothing: a real Starlight
 * route's CSS mentions `.sl-markdown-content` 75 times and
 * `.conloca-prose` zero times, so filtering on the Conloca class alone
 * returned an empty sheet and the editor's own defaults went unchallenged.
 *
 * Why "rooted at" (starts with the class) rather than "mentions" it: this
 * tier injects UNLAYERED, because the editor's default prose scale is
 * unlayered and layered rules lose to unlayered ones regardless of
 * specificity. Unlayered site CSS would equally beat the admin chrome's
 * Tailwind utilities (those live in @layer), so a bare-tag global like
 * `h2 { font-size: 60px }` would restyle the editor shell itself. A rule
 * rooted at a scope class cannot: both classes exist only inside the editor
 * surround. Loosening this to a substring or `:has()` test would forfeit
 * that guarantee — don't.
 *
 * Parsing uses the browser's own CSSOM (detached <style> tag) for rules and
 * declarations. Selector lists are then split only at top-level commas so
 * functional selectors such as `:is(h1, h2)` stay intact.
 */
export function filterProseSurfaceCss(css: string, hostWrapperClass?: string | null): string {
  if (typeof document === 'undefined' || !css.trim()) return '';

  // The scope roots a rule may be anchored to. `hostWrapperClass` is a raw
  // `class` attribute, so it can carry several tokens (`"prose card"`); each
  // is a legitimate root, because the wrapper clone renders all of them and
  // the host's sheet may key off any one. Dedupe against the Conloca class so
  // a wrapper already carrying it doesn't emit every rule twice.
  const scopes = [
    PROSE_SCOPE,
    ...(hostWrapperClass ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => `.${token}`)
      .filter((selector) => selector !== PROSE_SCOPE),
  ];

  const tag = document.createElement('style');
  // media="not all" keeps the browser from APPLYING the sheet while parsed.
  tag.media = 'not all';
  tag.textContent = css;
  document.head.appendChild(tag);
  try {
    const sheet = tag.sheet;
    if (!sheet) return '';
    // Flattening drops the layer wrappers, so the ONLY thing left to express
    // the host's intended precedence among the kept rules is their order in
    // the emitted text. Source order alone is not that: Astro emits
    // Starlight's sublayer blocks in a different order than the sheet
    // DECLARES them (real output emits `starlight.components` before
    // `starlight.content`, while the declaration puts components AFTER
    // content). Flattening on source order would silently invert those two.
    // So sort by declared layer precedence, keeping source order within a
    // layer, and let unlayered host rules stay last — they outrank every
    // layered one, and this tier is emitted unlayered as a whole.
    const order = collectLayerOrder(sheet.cssRules, null, []);
    return filterRuleList(sheet.cssRules, scopes, null)
      .map((entry, index) => ({ entry, index, key: layerSortKey(entry.layerPath, order) }))
      .sort((left, right) => compareLayerKeys(left.key, right.key) || left.index - right.index)
      .map(({ entry }) => entry.text)
      .join('\n');
  } catch {
    // A stylesheet the browser cannot parse contributes nothing; the canvas
    // path (which takes the sheet whole) is unaffected by this filter.
    return '';
  } finally {
    tag.remove();
  }
}

/**
 * Layer names in the order the sheet establishes precedence for them: every
 * `@layer a, b;` statement contributes its names in list order, and a block
 * for a layer never named in a statement is appended on first sight. Nested
 * blocks are recorded by full dotted path, matching how sublayers are named.
 */
function collectLayerOrder(rules: CSSRuleList, parentPath: string | null, order: string[]): string[] {
  for (const rule of Array.from(rules)) {
    if (rule.type === 0 && /^@layer\b/i.test(rule.cssText)) {
      const names =
        'nameList' in rule
          ? Array.from((rule as CSSLayerStatementRule).nameList)
          : [(rule as CSSLayerBlockRule).name].filter(Boolean);
      for (const name of names) {
        const path = parentPath === null ? name : `${parentPath}.${name}`;
        if (!order.includes(path)) order.push(path);
      }
      if ('cssRules' in rule) {
        const name = (rule as CSSLayerBlockRule).name;
        const path = !name ? parentPath : parentPath === null ? name : `${parentPath}.${name}`;
        collectLayerOrder((rule as CSSGroupingRule).cssRules, path, order);
      }
      continue;
    }
    if ('cssRules' in rule) collectLayerOrder((rule as CSSGroupingRule).cssRules, parentPath, order);
  }
  return order;
}

/**
 * Precedence key for a layer path: the position of each of its prefixes in
 * `order`, so `starlight.content` sorts inside `starlight`'s slot and against
 * its siblings. An unlayered rule sorts last — unlayered beats layered. A
 * prefix the sheet never declared yields -1, ie earliest.
 */
function layerSortKey(layerPath: string | null, order: readonly string[]): readonly number[] {
  if (layerPath === null) return [Number.POSITIVE_INFINITY];
  const segments = layerPath.split('.');
  return segments.map((_, depth) => order.indexOf(segments.slice(0, depth + 1).join('.')));
}

function compareLayerKeys(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? -1) - (right[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}

const PROSE_SCOPE = '.conloca-prose';

// CSSRule.type constants — deprecated in favor of instanceof, but the class
// globals (CSSFontFaceRule, CSSSupportsRule, …) aren't reliably exposed in
// every runtime this code is tested under; the numeric types are universal.
const STYLE_RULE = 1;
const MEDIA_RULE = 4;
const FONT_FACE_RULE = 5;
const SUPPORTS_RULE = 12;

/** Split only top-level selector-list commas; commas inside :is(), :where(),
 * :not(), attribute values, and strings remain part of their selector branch. */
function splitSelectorList(selectorText: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < selectorText.length; index += 1) {
    const char = selectorText[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') parentheses += 1;
    else if (char === ')') parentheses = Math.max(0, parentheses - 1);
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets = Math.max(0, brackets - 1);
    else if (char === ',' && parentheses === 0 && brackets === 0) {
      selectors.push(selectorText.slice(start, index).trim());
      start = index + 1;
    }
  }

  selectors.push(selectorText.slice(start).trim());
  return selectors.filter(Boolean);
}

function filterStyleRule(rule: CSSStyleRule, scopes: readonly string[]): string | null {
  const selectors = splitSelectorList(rule.selectorText).filter((selector) =>
    // Anchored AT a scope class — the selector's first compound — not merely
    // mentioning it somewhere. The character after the match may not continue
    // a class name, so `.conloca-prose-wide` never passes as `.conloca-prose`.
    scopes.some((scope) => selector.startsWith(scope) && !/[\w-]/.test(selector[scope.length] ?? '')),
  );
  if (selectors.length === 0) return null;
  return `${selectors.join(', ')} { ${rule.style.cssText} }`;
}

/**
 * `@layer name { … }` — the BLOCK form, which groups rules.
 *
 * Neither layer form has a legacy numeric `type` (both report 0), and both
 * serialize with an `@layer` prelude, so the discriminator has to be the
 * grouping capability itself. The statement form (`@layer a, b;`, which every
 * real Starlight/Tailwind sheet opens with) carries `nameList` and NO
 * `cssRules`; treating it as a group would hand `Array.from(undefined)` to the
 * walker, and that throw is swallowed by the caller's catch — turning the
 * whole tier back into an empty string with nothing logged. Capability check,
 * not serialization check.
 */
function isLayerBlockRule(rule: CSSRule): rule is CSSLayerBlockRule {
  return rule.type === 0 && 'cssRules' in rule && /^@layer\b/i.test(rule.cssText);
}

/** A kept rule plus the layer it came from (`null` = unlayered), so the
 * caller can re-establish precedence after the wrappers are flattened. */
interface KeptRule {
  text: string;
  layerPath: string | null;
}

function filterRuleList(rules: CSSRuleList, scopes: readonly string[], layerPath: string | null): KeptRule[] {
  const kept: KeptRule[] = [];
  for (const rule of Array.from(rules)) {
    if (rule.type === FONT_FACE_RULE) {
      kept.push({ text: rule.cssText, layerPath });
      continue;
    }
    if (rule.type === STYLE_RULE) {
      const filtered = filterStyleRule(rule as CSSStyleRule, scopes);
      if (filtered) kept.push({ text: filtered, layerPath });
      continue;
    }
    // `@layer name { … }`: descend, and FLATTEN — the layer wrapper is
    // deliberately NOT re-emitted.
    //
    // Host frameworks ship their prose rules inside their own layers
    // (Starlight puts all 75 of its `.sl-markdown-content` rules inside
    // `@layer starlight.content` and friends; not one is top-level). Two
    // consequences, both load-bearing:
    //
    //   1. Without descending, this filter keeps NOTHING from such a sheet —
    //      the layer block is not a style rule, so every rule inside it was
    //      invisible here.
    //   2. Re-emitting the layer would hand back the cascade win this whole
    //      tier exists to take. The tier is injected unlayered precisely
    //      because the editor's own prose defaults are unlayered; a rule
    //      re-wrapped in `@layer starlight.content` loses to them again.
    //
    // The layer each kept rule came from is carried out with it, and the
    // caller re-sorts by declared layer order.
    //
    // BE AWARE OF WHAT THIS IS: taken together with `collectLayerOrder` /
    // `layerSortKey` / `compareLayerKeys` above, it RE-IMPLEMENTS A SLICE OF
    // THE BROWSER'S OWN CASCADE ORDERING in userland. That is a real cost and
    // a deliberate decision, not an accident — do not extend it casually.
    //
    // It is unavoidable given the constraint: the tier MUST be unlayered
    // (that is the only way to beat the editor's unlayered prose defaults),
    // and un-layering a sheet necessarily destroys the precedence its layers
    // encoded. Something has to re-establish that precedence, and the browser
    // will not do it for rules it no longer sees as layered. The alternative —
    // keep the layers — is not an alternative at all: it loses the cascade to
    // the editor's own defaults, which is the entire bug this tier fixes.
    //
    // Scope is deliberately narrow: order only, only among rules that already
    // survived the scope filter. No specificity maths, no `!important`
    // handling, no revert/layer-statement semantics beyond ordering. If this
    // ever needs more than ordering, that is the signal to stop and move to
    // build-time computed-style capture instead of growing a cascade engine.
    if (isLayerBlockRule(rule)) {
      const name = rule.name;
      const nested = !name ? layerPath : layerPath === null ? name : `${layerPath}.${name}`;
      kept.push(...filterRuleList(rule.cssRules, scopes, nested));
      continue;
    }
    // Conditional groups (@media, @supports): keep the wrapper only when it
    // still contains scope-rooted rules after filtering its body. The group
    // inherits the enclosing layer, so its kept body sorts as one unit.
    if (rule.type === MEDIA_RULE || rule.type === SUPPORTS_RULE) {
      const group = rule as CSSConditionRule;
      const inner = filterRuleList(group.cssRules, scopes, layerPath);
      if (inner.length > 0) {
        const prelude = rule.type === MEDIA_RULE ? '@media' : '@supports';
        kept.push({
          text: `${prelude} ${group.conditionText} {\n${inner.map((entry) => entry.text).join('\n')}\n}`,
          layerPath,
        });
      }
    }
    // Everything else (@keyframes, @property, the `@layer a, b;` statement
    // form, @import already stripped by the injector, …) has no business on
    // the typing surface: dropped.
  }
  return kept;
}
