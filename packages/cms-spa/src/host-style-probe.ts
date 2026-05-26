import { useEffect, useState } from 'react';

/**
 * Host-style probe — captures the host's computed styles for prose
 * elements directly from the rendered live page, then exposes a
 * stylesheet the editor can inject so its typed elements look like
 * the published ones.
 *
 * Why a probe exists alongside the CSS grabber + wrapper auto-copy:
 *
 * - The CSS grabber + wrapper auto-copy work when the host styles
 *   prose through CLASS-on-WRAPPER descendant selectors:
 *   `.sl-markdown-content h1 { ... }`, `.prose h1 { ... }`. The editor
 *   gets wrapped in a clone of the host's wrapper, and the host's
 *   already-grabbed CSS reaches its typed elements via the cascade.
 *
 * - But some hosts style prose differently:
 *   - Utility-first Tailwind: `<h1 class="text-5xl font-bold">` — the
 *     styling is per-element via utility classes. The editor's typed
 *     `<h1>` has no utility classes; cascade can't help.
 *   - Inline styles: `<h1 style="...">` — only applies to that one
 *     element; not reusable via cascade.
 *
 *   For both cases, the FINAL rendered styles still resolve to a
 *   normal set of CSS property values. `getComputedStyle()` reads
 *   them regardless of source. The probe captures those final values
 *   from a real rendered sample on the live page and synthesizes a
 *   stylesheet — `.conloca-prose--editor h1 { font-size: ...; ... }`
 *   — that styles the editor's typed elements to match.
 *
 * Approach:
 *
 *   1. Open a hidden same-origin iframe to the page's published URL.
 *   2. Find the host's prose wrapper inside the iframe (or fall back
 *      to `<main>` / `<body>`).
 *   3. For each prose tag we care about, prefer an existing element
 *      in the wrapper (so utility classes / inline styles on real
 *      elements are observed). Inject a synthetic probe element when
 *      no existing sample is present — descendant-selector hosts
 *      style the synthetic via the cascade.
 *   4. Read the relevant computed style properties; build a CSS rule
 *      scoped to `.conloca-prose--editor <tag>`.
 *   5. Tear down the iframe.
 *
 * Generic across hosts because it never reads source CSS — it reads
 * the cascade's resolved output. Descendant selectors, utility
 * classes, and inline styles all funnel into `getComputedStyle()`
 * the same way.
 */

/** Prose elements whose computed styles we capture, split by how
 * they need to be probed. Block-level tags get probed directly under
 * the prose wrapper (their styles don't depend on inline context).
 * Inline tags get probed INSIDE a synthetic `<p>` so their font-size
 * inherits from paragraph context, not from a heading they might
 * happen to appear inside on the live page (eg an anchor inside an
 * <h2> would otherwise capture 35px as its font-size and the editor's
 * inline links would all render heading-sized).
 *
 * `li`, `th`, `td` are inline-context tags too: they're inside a
 * parent (`ul`/`ol`, `tr`) that establishes their typography. We
 * probe them directly under the wrapper because their parent's
 * styling is captured separately and the cascade handles inheritance. */
const BLOCK_PROBE_TAGS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'pre',
  'ul',
  'ol',
  'li',
  'blockquote',
  'table',
  'th',
  'td',
  'hr',
] as const;
const INLINE_PROBE_TAGS = ['a', 'strong', 'em', 'code'] as const;

/** Computed-style properties to capture per tag. Chosen for breadth —
 * we want enough to make the editor look similar without over-
 * specifying things that vary by selection state or container. Skips
 * `width`, `height`, `display`, etc. which would distort the editor's
 * own layout. */
const PROBE_PROPS = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'color',
  'background-color',
  'margin-block-start',
  'margin-block-end',
  'margin-inline-start',
  'margin-inline-end',
  'padding-block-start',
  'padding-block-end',
  'padding-inline-start',
  'padding-inline-end',
  'border-radius',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'text-decoration-line',
  'text-decoration-color',
  'text-decoration-thickness',
  'text-underline-offset',
  'list-style-type',
  'list-style-position',
] as const;

const IFRAME_TIMEOUT_MS = 10_000;

/**
 * Locate the host's prose wrapper inside the iframe's document, given
 * the className the server-side discovery already resolved (eg
 * `sl-markdown-content` for Starlight, `prose` for Tailwind Typography).
 * We avoid duplicating the find-wrapper heuristic here: the server-side
 * `findContentWrapper` does the smart majority+depth walk against raw
 * HTML and gives us the right answer. The probe just resolves that
 * className back to an actual element inside the iframe.
 *
 * Returns null when the class isn't found (probe falls back to no-op)
 * or when no className was provided (host has no classed wrapper).
 */
function findWrapperByClass(doc: Document, className: string | null): HTMLElement | null {
  if (!className) return doc.querySelector('main');
  // Match an element carrying ALL the classes in the discovered name
  // (preserves Astro scoped-hash matching: `astro-xxxx` must be on the
  // same element). `.foo.bar` requires all listed classes.
  const selector = '.' + className.split(/\s+/).filter(Boolean).join('.');
  const found = doc.querySelector(selector);
  return (found as HTMLElement) ?? (doc.querySelector('main') as HTMLElement) ?? null;
}

/**
 * Read computed styles for each PROBE_TAG inside a freshly loaded
 * iframe's document. Returns one CSS rule string per tag, scoped to
 * `.conloca-prose--editor <tag>` so it targets the editor's typed
 * elements without leaking into the rest of the admin chrome.
 */
function buildProbeStylesheet(doc: Document, wrapperClass: string | null): string {
  const wrapper = findWrapperByClass(doc, wrapperClass);
  const view = doc.defaultView;
  if (!view || !wrapper) return '';

  const rules: string[] = [];

  // Wrapper-level: capture inherited typography (font-family, color,
  // line-height, etc.) that the host's prose container resolves through
  // BODY inheritance. The probe can't read the cascade source, only
  // the resolved computed values, but that's exactly what we want here:
  // whatever the host's body/wrapper combination computes to.
  //
  // Why this matters: hosts like Starlight set `font-family: var(--sl-font)`
  // on body and never on `.sl-markdown-content`. On the published page
  // the wrapper inherits Inter. In the editor, MDXEditor's `_editorRoot_*`
  // wrapper rule sets `font-family: var(--font-body)` (a generic system
  // stack) and `color: var(--baseText)` (its own palette). Inheritance
  // flows through THAT to the host's `.sl-markdown-content` clone and
  // then to the contenteditable. Probing the wrapper and emitting a
  // direct `:where(.conloca-prose--editor) { font: ...; color: ... }`
  // rule beats inheritance and restores the host's typography.
  const wrapperRule = probeWrapper(view, wrapper);
  if (wrapperRule) rules.push(wrapperRule);

  // Block-level: inject INSIDE a synthetic two-element sequence so
  // adjacent-sibling rules fire during the probe. Hosts like Starlight
  // apply prose spacing via `:not(...) + :not(...) { margin-top: ... }`
  // — the rule only fires when an element has a preceding sibling. A
  // single-sample probe would catch the first-child margin (zero) and
  // override the host's adjacent-sibling rule via specificity, so the
  // editor's later paragraphs/headings would render flush against each
  // other.
  //
  // We always use `<p>` as the preceding sibling because: (a) every
  // prose block tag commonly follows a paragraph in real content; (b)
  // Starlight's spacing rules are sibling-type-agnostic except for the
  // "heading after non-heading" rule, which also fires when the
  // previous sibling is a `<p>`.
  for (const tag of BLOCK_PROBE_TAGS) {
    const rule = probeBlockTagInSiblingContext(view, wrapper, tag);
    if (rule) rules.push(rule);
  }

  // Inline: always inject inside a synthetic `<p>` (newly added under
  // the wrapper) so font-size / line-height etc. inherit from a
  // paragraph context. Otherwise an anchor we find inside a heading
  // would tell us "links are 35px," and the editor's inline links
  // would render heading-sized. Removed after probing.
  const synthParent = doc.createElement('p');
  synthParent.setAttribute('data-conloca-probe-parent', 'true');
  wrapper.appendChild(synthParent);
  try {
    for (const tag of INLINE_PROBE_TAGS) {
      const rule = probeInlineTag(view, synthParent, tag);
      if (rule) rules.push(rule);
    }
  } finally {
    synthParent.remove();
  }

  return rules.join('\n');
}

/**
 * Probe a block tag with an injected `<p>` preceding sibling so any
 * adjacent-sibling spacing rules in the host's CSS fire while reading
 * computed styles. This gives the "this element follows other content"
 * margin context that single-sample probing misses.
 *
 * Special-case: when probing `<p>` itself we use another `<p>` as
 * the preceding sibling. For `<li>` and table-cell tags we need to
 * inject them inside a parent (`<ul>`/`<ol>`/`<table>`), preceded by
 * a sibling of the same kind so list-item and cell adjacency rules fire.
 */
function probeBlockTagInSiblingContext(view: Window, wrapper: HTMLElement, tag: string): string {
  const doc = wrapper.ownerDocument;

  // Build the synthetic context. The element we read is always
  // `target` — everything before it just creates the right adjacency.
  let host: HTMLElement;
  let target: HTMLElement;
  if (tag === 'li') {
    host = doc.createElement('ul');
    host.appendChild(makeProbeEl(doc, 'li'));
    target = makeProbeEl(doc, 'li');
    host.appendChild(target);
  } else if (tag === 'th' || tag === 'td') {
    host = doc.createElement('table');
    const tr1 = doc.createElement('tr');
    tr1.appendChild(makeProbeEl(doc, tag));
    host.appendChild(tr1);
    const tr2 = doc.createElement('tr');
    target = makeProbeEl(doc, tag);
    tr2.appendChild(target);
    host.appendChild(tr2);
  } else {
    // Standard "block element after a paragraph" context.
    host = doc.createElement('div');
    host.setAttribute('data-conloca-probe-host', 'true');
    host.appendChild(makeProbeEl(doc, 'p'));
    target = makeProbeEl(doc, tag);
    host.appendChild(target);
  }

  host.setAttribute('data-conloca-probe-host', 'true');
  wrapper.appendChild(host);

  try {
    return generateRule(view, target, tag);
  } finally {
    host.remove();
  }
}

/** Properties read directly off the host's prose wrapper. These are the
 * typography "defaults" that hosts conventionally set on body and let
 * inherit down — the wrapper itself rarely overrides them, so its
 * computed values reflect the host's resolved body typography.
 *
 * Excludes margin/padding/border/background: those are wrapper layout
 * concerns that the editor shouldn't inherit (the editor lives inside
 * the CMS SPA shell, not the host's page layout). */
const WRAPPER_PROBE_PROPS = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'color',
] as const;

/**
 * Emit the host wrapper's computed typography as CSS custom properties
 * on `:root`. The editor's `editor-styles.css` reads these via
 * `var(--conloca-host-*)` on `[class*="_contentEditable_"]` to override
 * MDXEditor's bundled typography (`color: var(--baseTextContrast)`,
 * `font-family: var(--font-body)`).
 *
 * Why route through custom properties instead of styling the wrapper
 * directly: MDXEditor's `._contentEditable_*` rule is unlayered, so any
 * layered probe rule loses the cascade regardless of selector
 * specificity. Custom properties inherit through cascade layers and can
 * be consumed by an unlayered rule in `editor-styles.css`, which DOES
 * compete on equal terms with MDXEditor and wins on source order
 * (editor-styles.css is imported after `@mdxeditor/editor/style.css`).
 *
 * Property names: short, namespaced under `--conloca-host-`. Map 1:1 to
 * the inheritance-eligible typography properties that drive prose look.
 */
function probeWrapper(view: Window, wrapper: HTMLElement): string {
  const cs = view.getComputedStyle(wrapper);
  const propMap: Record<(typeof WRAPPER_PROBE_PROPS)[number], string> = {
    'font-family': '--conloca-host-font-family',
    'font-size': '--conloca-host-font-size',
    'font-weight': '--conloca-host-font-weight',
    'font-style': '--conloca-host-font-style',
    'line-height': '--conloca-host-line-height',
    'letter-spacing': '--conloca-host-letter-spacing',
    color: '--conloca-host-color',
  };
  const decls: string[] = [];
  for (const prop of WRAPPER_PROBE_PROPS) {
    const value = cs.getPropertyValue(prop);
    if (value && value !== 'normal' && value !== 'none') {
      decls.push(`${propMap[prop]}: ${value}`);
    }
  }
  if (decls.length === 0) return '';
  return `:root { ${decls.join('; ')}; }`;
}

function makeProbeEl(doc: Document, tag: string): HTMLElement {
  const el = doc.createElement(tag);
  el.textContent = 'probe';
  el.setAttribute('data-conloca-probe', 'true');
  return el;
}

/** Properties that only carry meaning on list-container tags (ul, ol).
 * Inherited by descendants but only renders a marker on actual list
 * items — emitting it on every tag would override `<ol>`'s `decimal`
 * with `<li>`'s inherited `disc` (since `li` is more specific to the
 * rendered element), making ordered lists show bullets instead of
 * numbers. Filtered out for any tag other than ul/ol. */
const LIST_STYLE_PROPS = new Set(['list-style-type', 'list-style-position']);

function generateRule(view: Window, sample: HTMLElement, tag: string): string {
  const cs = view.getComputedStyle(sample);
  const decls: string[] = [];
  const isListContainer = tag === 'ul' || tag === 'ol';
  for (const prop of PROBE_PROPS) {
    if (LIST_STYLE_PROPS.has(prop) && !isListContainer) continue;
    const value = cs.getPropertyValue(prop);
    if (value && value !== 'normal' && value !== 'none') {
      decls.push(`${prop}: ${value}`);
    }
  }
  if (decls.length === 0) return '';
  // Wrap the wrapper class in `:where()` so the selector has the same
  // specificity as a bare element selector (0,0,1). Without :where(),
  // `.conloca-prose--editor ol` has specificity (0,1,1) — higher than
  // host component rules like `.sl-steps` (0,1,0), so the probe's
  // "ol defaults" override component-specific styling on `<ol>`
  // elements that carry component classes (Steps, Tabs, etc.).
  // With :where() the probe acts as a defaults layer for BARE prose
  // tags: any host class selector targeting the same element wins.
  return `:where(.conloca-prose--editor) ${tag} { ${decls.join('; ')}; }`;
}

/**
 * Probe an inline tag inside the given parent (a synthetic `<p>` from
 * the caller). Inline tags need a paragraph context so font-size etc.
 * inherit from the right place — otherwise an `<a>` found inside an
 * `<h2>` would capture heading-sized text.
 */
function probeInlineTag(view: Window, parent: HTMLElement, tag: string): string {
  const doc = parent.ownerDocument;
  const sample = makeProbeEl(doc, tag);
  parent.appendChild(sample);
  try {
    return generateRule(view, sample, tag);
  } finally {
    sample.remove();
  }
}

/**
 * Run a one-shot probe against `routeUrl`. Returns the generated
 * stylesheet, or an empty string when the iframe failed to load or
 * the page had no probable elements.
 *
 * `signal` lets the caller cancel a probe (eg the user navigated to
 * a different page mid-fetch). Cleanup is best-effort.
 */
export function probeHostStyles(
  routeUrl: string,
  wrapperClass: string | null,
  theme: 'light' | 'dark' | null,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve('');
      return;
    }

    const iframe = document.createElement('iframe');
    // Width chosen so responsive prose styles resolve at their desktop
    // tier (Starlight's `--sl-text-h2` etc. shift via media queries; a
    // narrower probe captures the mobile-ish values which don't match
    // what the editor's user actually sees). 1440px is a sane "desktop"
    // default. The iframe is off-screen and hidden so width affects
    // only CSS resolution, not user-visible layout.
    iframe.style.cssText = 'position:absolute;left:-9999px;top:0;width:1440px;height:900px;visibility:hidden;border:0';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    iframe.setAttribute('data-conloca-probe-iframe', '');
    iframe.src = routeUrl;

    let settled = false;
    const cleanup = () => {
      if (iframe.parentElement) iframe.parentElement.removeChild(iframe);
    };
    const settle = (css: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(css);
    };

    const abortHandler = () => settle('');
    signal?.addEventListener('abort', abortHandler);

    const timeout = window.setTimeout(() => {
      console.warn('[Conloca] Host style probe timed out for', routeUrl);
      settle('');
    }, IFRAME_TIMEOUT_MS);

    iframe.addEventListener('load', () => {
      window.clearTimeout(timeout);

      // Force the iframe's theme to MATCH the editor's currently-active
      // theme — not whatever the website's own theme provider resolved
      // from its own localStorage key. The editor and the published
      // page maintain independent theme preferences (the CMS SPA uses
      // `conloca-theme`; Starlight uses `starlight-theme`), so by default
      // the iframe paints in the website's last-saved scheme regardless
      // of what the user is editing in. We override `data-theme` (and
      // mirror as `.dark` class for Tailwind-style hosts) so the probe
      // captures the scheme the editor is rendering, not the published
      // page's stale scheme.
      try {
        const doc = iframe.contentDocument;
        if (doc && theme) {
          doc.documentElement.dataset.theme = theme;
          doc.documentElement.classList.toggle('dark', theme === 'dark');
          doc.documentElement.style.colorScheme = theme;
        }
      } catch (err) {
        // Same-origin iframe access can throw if the dev server emitted
        // a sandboxed page; swallow and proceed with the probe anyway —
        // worst case we capture the website's default theme values.
        console.warn('[Conloca] Could not set probe iframe theme:', err);
      }

      // Two rAFs: first lands us after layout, second after the
      // browser has applied any deferred styles (web fonts, etc.) AND
      // any theme-attribute change applied above has propagated through
      // the cascade. 2× rAF is a common idiom for "next paint with
      // fonts ready."
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (signal?.aborted) {
            settle('');
            return;
          }
          try {
            const doc = iframe.contentDocument;
            if (!doc) {
              settle('');
              return;
            }
            const css = buildProbeStylesheet(doc, wrapperClass);
            settle(css);
          } catch (err) {
            console.warn('[Conloca] Host style probe failed:', err);
            settle('');
          }
        });
      });
    });

    iframe.addEventListener('error', () => {
      window.clearTimeout(timeout);
      settle('');
    });

    document.body.appendChild(iframe);
  });
}

/**
 * React hook wrapper. Re-probes whenever `routeUrl` changes or the
 * document's theme attribute changes (so dark/light swaps refresh
 * the captured styles).
 *
 * Returns the generated stylesheet as a single string. Callers feed
 * it into `useInjectHostStyles` (or any other stylesheet injector)
 * with a sensible layer name.
 */
export function useProbedHostStyles(
  routeUrl: string | undefined,
  wrapperClass: string | null,
  options: { theme?: 'light' | 'dark' | null } = {},
): string {
  const [css, setCss] = useState<string>('');
  const theme = options.theme ?? null;

  useEffect(() => {
    if (!routeUrl) {
      setCss('');
      return;
    }

    const controller = new AbortController();
    probeHostStyles(routeUrl, wrapperClass, theme, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setCss(result);
    });

    return () => {
      controller.abort();
    };
  }, [routeUrl, wrapperClass, theme]);

  return css;
}
