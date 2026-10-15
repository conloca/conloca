import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { ThemeProvider, useTheme } from '../../hooks/useTheme.js';
import { setHostDiscovery } from '../../host-discovery.js';
import { filterProseSurfaceCss } from '../../prose-surface-css.js';
import { setSiteStyles, useInjectHostStyles } from '../../site-styles.js';
import { THEME_STORAGE_KEY } from '../../theme.js';
import { CMSMDXEditor } from './CMSMDXEditor.js';

/**
 * Host parity for the MDX typing surface when a host app that embeds the
 * editor supplies the discovery facts, measured in a real browser.
 *
 * This story sets up that style path on its own, which is the only one where
 * the defect lives:
 *
 *   - no `previewRouteUrl`, so `/api/styles` and `/api/content-wrapper` are
 *     never consulted (a host app need not serve them, and they contribute
 *     nothing) and the computed-style probe stays inert;
 *   - `setHostDiscovery(...)` supplies the discovery facts (`routeCss` +
 *     `hostWrappers`) a host app writes into the registry after `configureUI`,
 *     so the registered-discovery tier is the active one.
 *
 * `ROUTE_CSS` below is an example host app's route CSS: a reduced Starlight
 * sheet whose selectors, custom-property values and — critically —
 * cascade-layer nesting follow Starlight's built output for a dark
 * documentation theme. The values it resolves to are: h2 35px/600
 * `rgb(248, 250, 252)`, body `rgb(226, 232, 240)`, inline-code background
 * `rgb(30, 41, 59)`, page surface `rgb(2, 6, 23)`.
 *
 * Two properties of a real Starlight sheet are what the regression turns on,
 * so the fixture keeps both:
 *
 *   1. Every prose rule is nested inside `@layer starlight.*`. In Starlight's
 *      built CSS every `.sl-markdown-content` rule is inside a layer block or
 *      `@media print`; none is top-level. A filter that does not descend
 *      into `@layer` keeps zero of them.
 *   2. The prose rules are rooted at `.sl-markdown-content` — the wrapper
 *      class discovered from the built HTML — and never at `.conloca-prose`.
 */

const ROUTE_CSS = `
@layer properties,base,starlight,theme,components,utilities;
@layer starlight.base,starlight.reset,starlight.core,starlight.content,starlight.components,starlight.utils;
:root{
  --sl-font: "Inter", system-ui, -apple-system, sans-serif;
  --sl-color-white: #f8fafc;
  --sl-color-text: #e2e8f0;
  --sl-color-bg: #020617;
  --sl-color-gray-5: #1e293b;
  --sl-color-gray-6: #0f172a;
}
@layer starlight.base{
  :root,::backdrop{
    --sl-text-xs: .8125rem;
    --sl-text-sm: .875rem;
    --sl-text-3xl: 1.8125rem;
    --sl-text-4xl: 2.1875rem;
    --sl-text-h2: var(--sl-text-3xl);
    --sl-text-code: var(--sl-text-sm);
    --sl-text-code-sm: var(--sl-text-xs);
    --sl-line-height: 1.75;
    --sl-line-height-headings: 1.2;
    --sl-content-gap-y: 1rem;
    --sl-color-bg-inline-code: var(--sl-color-gray-5);
    --sl-font-system: ui-sans-serif, system-ui, sans-serif;
    --__sl-font: var(--sl-font, var(--sl-font-system)), var(--sl-font-system);
  }
  @media(min-width:50em){:root{--sl-text-h2: var(--sl-text-4xl)}}
}
@layer starlight.reset{
  body{font-family:var(--__sl-font);line-height:var(--sl-line-height);-webkit-font-smoothing:antialiased;color:var(--sl-color-text);background-color:var(--sl-color-bg)}
}
@layer starlight.content{
  .sl-markdown-content :is(h1,h2,h3,h4,h5,h6):not(:where(.not-content *)){color:var(--sl-color-white);line-height:var(--sl-line-height-headings);font-weight:600}
  .sl-markdown-content h2:not(:where(.not-content *)){font-size:var(--sl-text-h2)}
  .sl-markdown-content code:not(:where(.not-content *)){background-color:var(--sl-color-bg-inline-code);margin-block:-.125rem;padding:.125rem .375rem;font-size:var(--sl-text-code-sm)}
  .sl-markdown-content pre:not(:where(.not-content *)){border:1px solid var(--sl-color-gray-5);padding:.75rem 1rem;font-size:var(--sl-text-code);tab-size:2}
}
/* No bare-tag or admin-class canaries here on purpose. An unlayered
   h2 { font-size: 60px } is not realistic site CSS — unlayered beats every
   layered rule, so on a real page it would defeat the theme's own
   .sl-markdown-content h2 too, and the probe correctly measured 60px when it
   was present. Escape-to-admin-chrome coverage belongs at the filter, where
   prose-surface-css.test.ts asserts exact selector sets and proves bare tags
   and module classes are dropped. */
`;

const WRAPPER_CLASS = 'sl-markdown-content';

const MARKDOWN = [
  'Paragraph sample text.',
  '',
  '## Heading two sample',
  '',
  'Another paragraph with `inline code` in it.',
  '',
  '```ts',
  'const x = 1;',
  '```',
  '',
].join('\n');

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

// Pin the admin theme to dark BEFORE `ThemeProvider` mounts and reads it — the
// regression shows in the dark theme, and a provider that resolved `system`
// first would leave `<html>` on the light scheme.
if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_STORAGE_KEY, 'dark');

/**
 * Mounts the editor the way `MdxPageEditor` does — inside the
 * `conloca-mdx-editor-surround` region, which is the `@scope` root the
 * layered host tier is rebased onto (`:root`/`body` → `:scope`).
 */
function EmbeddedEditorHarness({ themeControls = false }: { themeControls?: boolean }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Both registries a host writes after `configureUI` has run — the same
    // post-configure swap point `setSiteStyles` uses: the registered discovery
    // tier (route CSS + wrapper shape) and siteStyles.
    const routeCss = themeControls ? `${ROUTE_CSS}${LIGHT_ROUTE_CSS}` : ROUTE_CSS;
    setSiteStyles([routeCss]);
    setHostDiscovery({
      routeCss,
      wrappers: { content: { tagName: 'div', className: WRAPPER_CLASS }, codeBlock: null },
    });
    setReady(true);
    return () => {
      setSiteStyles([]);
      setHostDiscovery({});
    };
  }, [themeControls]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <EmbeddedEditorSurface ready={ready} themeControls={themeControls} />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/**
 * The host's light palette, keyed off the attribute form Starlight uses. Only
 * the theme-switching story installs it, so every other story keeps measuring
 * the dark sheet alone.
 */
const LIGHT_ROUTE_CSS = `
:root[data-theme="light"] {
  --sl-color-white: #172554;
  --sl-color-text: #334155;
  --sl-color-bg: #f8fafc;
  --sl-color-gray-5: #e2e8f0;
  --sl-color-gray-6: #f1f5f9;
}
`;

/**
 * The markdown is held here, above the editor, the way `MdxPageEditor` holds
 * the page body: closing the editor unmounts `CMSMDXEditor` but keeps the text,
 * so reopening proves what the editor serialized, not what it still had in
 * memory.
 */
function EmbeddedEditorSurface({ ready, themeControls }: { ready: boolean; themeControls: boolean }) {
  const [value, setValue] = useState(MARKDOWN);
  const [mounted, setMounted] = useState(true);
  const { resolvedTheme, setTheme } = useTheme();
  const surfaceTheme = themeControls ? resolvedTheme : 'dark';
  return (
    <>
      {/* Admin chrome sibling: must never be reached by host CSS. */}
      <h2
        className={themeControls ? 'admin-escape-canary text-foreground' : 'admin-escape-canary'}
        data-testid="admin-chrome-heading"
      >
        Admin chrome heading
      </h2>
      {themeControls && (
        <>
          <button type="button" onClick={() => setTheme('light')}>
            Use light theme
          </button>
          <button type="button" onClick={() => setTheme('dark')}>
            Use dark theme
          </button>
          <button type="button" onClick={() => setMounted((current) => !current)}>
            {mounted ? 'Close editor' : 'Reopen editor'}
          </button>
          <pre data-testid="serialized-markdown">{value}</pre>
        </>
      )}
      <div
        className={`conloca-mdx-editor-surround ${surfaceTheme}`}
        data-theme={surfaceTheme}
        data-testid="surround"
        style={{ height: 520 }}
      >
        {ready && mounted && <CMSMDXEditor value={value} onChange={setValue} />}
      </div>
    </>
  );
}

const TRACKED = ['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background-color'] as const;

type Measured = Record<(typeof TRACKED)[number], string>;

function measure(el: Element): Measured {
  const computed = getComputedStyle(el);
  return Object.fromEntries(TRACKED.map((prop) => [prop, computed.getPropertyValue(prop)])) as Measured;
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Poll for a descendant, failing loudly rather than measuring nothing. */
function waitForElement<T extends HTMLElement>(root: ParentNode, selector: string, label: string): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const deadline = Date.now() + 15000;
  const tick = () => {
    const found = root.querySelector<T>(selector);
    if (found) return resolve(found);
    if (Date.now() > deadline) return reject(new Error(`${label} never rendered`));
    setTimeout(tick, 50);
  };
  tick();
  return promise;
}

/**
 * Inline-style sanity check. A measurement pipeline pointed at a stale or
 * detached element returns confident nonsense, so before trusting ANY
 * reading, write a value no stylesheet uses and confirm it reads back.
 */
function assertReadableElement(el: HTMLElement, label: string): void {
  const before = el.style.color;
  el.style.color = 'rgb(1, 2, 3)';
  const seen = getComputedStyle(el).color;
  el.style.color = before;
  if (seen !== 'rgb(1, 2, 3)') {
    throw new Error(`sanity check failed for ${label}: wrote rgb(1, 2, 3), read back ${seen}`);
  }
}

/** Poll until two consecutive reads agree — the tiers land across effects,
 * a fetch rejection and a requestAnimationFrame bridge. */
async function settled(el: Element): Promise<Measured> {
  let previous = JSON.stringify(measure(el));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await delay(100);
    const next = JSON.stringify(measure(el));
    if (next === previous) return JSON.parse(next) as Measured;
    previous = next;
  }
  return JSON.parse(previous) as Measured;
}

/** Walk up for the first non-transparent background — the paper card, the
 * wrapper, or the surround, whichever actually paints. */
function paintedBackground(from: HTMLElement): string {
  let node: HTMLElement | null = from;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    node = node.parentElement;
  }
  return 'rgba(0, 0, 0, 0)';
}

const meta = {
  title: 'Editor/MdxEditorHostParity',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The typing surface paints the host's published typography.
 *
 * Every assertion is a computed value read off the rendered contenteditable,
 * and every number is what the fixture sheet above resolves to. The RED shape
 * this guards against is the editor's own unlayered prose default winning:
 * h2 28px/700 on a `#ffffff` paper card with `#181818` ink, which puts
 * `rgb(248, 250, 252)` headings on a white background.
 */
export const TypingSurfaceMatchesHostTypography: Story = {
  render: () => <EmbeddedEditorHarness />,
  play: async ({ canvasElement }) => {
    const surround = await waitForElement<HTMLElement>(canvasElement, '.conloca-mdx-editor-surround', 'surround');

    // The discovered wrapper class must exist INSIDE the typing surface and
    // be an ancestor of the prose, or the host's `.sl-markdown-content …`
    // rules match nothing no matter how faithfully they are kept.
    const wrapper = await waitForElement<HTMLElement>(surround, `.${WRAPPER_CLASS}`, 'host wrapper class');
    const editable = await waitForElement<HTMLElement>(wrapper, '.conloca-prose--editor', 'contenteditable');
    const h2 = await waitForElement<HTMLElement>(editable, 'h2', 'typing-surface h2');

    assertReadableElement(h2, 'typing-surface h2');
    assertReadableElement(editable, 'contenteditable');

    const code = await waitForElement<HTMLElement>(editable, 'code', 'inline code');
    assertReadableElement(code, 'inline code');

    // Measure everything before asserting anything, so a failure report
    // carries the whole surface rather than dying on the first property.
    const h2Styles = await settled(h2);
    const bodyStyles = await settled(editable);
    const codeStyles = await settled(code);
    // PROVENANCE — the assertions the tier deletion rests on. They distinguish
    // "the probe produced these values" from "the derived tier did", which no
    // computed-style read can do on its own. Only `buildProbeStylesheet` writes
    // into the `conloca-host-defaults` tag, so its text is unambiguous. The
    // inline `--conloca-host-body-bg` is NOT a usable signal: on the probe path
    // the bridge no longer writes it at all, and where the bridge does write it
    // the layered tier paints the surround navy regardless of what the probe
    // captured.
    const probeTag = document.querySelector('[data-conloca-host-styles-conloca-host-defaults]')?.textContent ?? '';
    // The probe owns the page surface, so the paper can be deleted with it.
    expect(probeTag).toContain('--conloca-host-body-bg: rgb(2, 6, 23)');
    // The host's own design tokens ride along RESOLVED, published onto the
    // editor's content region. This is what stops a `var()` in the host sheet
    // resolving to the wrong theme's value: the token arrives already resolved
    // in the editor's theme, so however that sheet spells its theme selectors
    // — attribute form, CSS nesting, anything `scopeHostCss` cannot re-target
    // — there is no selector left to match or miss.
    expect(probeTag).toContain(`${'.conloca-mdx-editor-surround'} {`);
    expect(probeTag).toContain('--sl-color-bg: #020617');
    // The probe owns heading metrics too. `:where()` is deliberate upstream
    // (host-style-probe.ts) to hold the rule at (0,0,1) — the SAME specificity
    // as editor-styles.css's own unlayered `:where(.conloca-prose--editor) h2
    // { 1.75em; 700 }`. Both unlayered and equal, so head order breaks the tie.
    // Once the tier is gone that tie is the only thing standing between 35px
    // and 28px, which is why the rule text and the computed value are asserted
    // together: text alone would not prove it wins, and the computed value
    // alone would not prove the probe is what produced it.
    expect(probeTag).toMatch(/:where\(\.conloca-prose--editor\) h2 \{[^}]*35px/);
    const surface = paintedBackground(editable);
    // Heading metrics come from the host sheet, not the editor's default
    // 1.75em/700 scale.
    expect(h2Styles['font-size']).toBe('35px');
    expect(h2Styles['font-weight']).toBe('600');
    expect(h2Styles.color).toBe('rgb(248, 250, 252)');

    // Body ink and face are the host's, not the `ui-sans-serif` floor and
    // not the `#181818` paper floor.
    expect(bodyStyles.color).toBe('rgb(226, 232, 240)');
    expect(bodyStyles['font-family']).not.toMatch(/^ui-sans-serif/);
    expect(bodyStyles['font-family']).toMatch(/Inter/);

    // The headline symptom: white-on-white. The heading ink is near-white,
    // so the surface underneath must not be.
    expect(surface).not.toBe('rgb(255, 255, 255)');
    expect(surface).toBe('rgb(2, 6, 23)');

    // Inline code: readable ink on the host's inline-code background.
    expect(codeStyles['background-color']).toBe('rgb(30, 41, 59)');
    expect(codeStyles.color).not.toBe('rgb(24, 24, 24)');
  },
};

/**
 * Nothing from the host sheet reaches admin chrome.
 *
 * The kept tier is injected UNLAYERED so it can beat the editor's own
 * unlayered prose defaults — which is exactly why "rooted at the scope
 * class" has to hold. `h2 { font-size: 60px; color: #ff00ff }` and
 * `.admin-escape-canary { outline: 7px solid #ff00ff }` are in the fixture
 * sheet; both must die in the filter.
 */
export const HostCssNeverReachesAdminChrome: Story = {
  render: () => <EmbeddedEditorHarness />,
  play: async ({ canvasElement }) => {
    const surround = await waitForElement<HTMLElement>(canvasElement, '.conloca-mdx-editor-surround', 'surround');
    // Wait for the tiers to land before judging what escaped.
    await waitForElement(surround, `.${WRAPPER_CLASS} .conloca-prose--editor h2`, 'typing surface');

    const adminHeading = await waitForElement<HTMLElement>(
      canvasElement,
      '[data-testid="admin-chrome-heading"]',
      'admin chrome heading',
    );
    assertReadableElement(adminHeading, 'admin chrome h2');

    const styles = measure(adminHeading);
    expect(styles['font-size']).not.toBe('60px');
    expect(styles.color).not.toBe('rgb(255, 0, 255)');
    expect(getComputedStyle(adminHeading).outlineWidth).not.toBe('7px');

    // The admin dark theme still paints its own chrome. `main.css` moved the
    // dark theme's `color` / `color-scheme` into `@layer cms-admin` so host
    // CSS can win inside the editor surround; this is the other half of that
    // trade — outside the surround, admin ink must be unchanged.
    expect(styles.color).toBe('rgb(250, 250, 250)');
    expect(getComputedStyle(document.documentElement).colorScheme).toBe('dark');
  },
};

/**
 * `filterProseSurfaceCss` descends cascade layers and flattens them.
 *
 * This lives in the browser target, not the bun suite, because happy-dom drops
 * `@layer` wholesale — it parses neither the statement form nor the block form,
 * and the block's contents vanish with it. A unit test asserting layer
 * behaviour there would pass while proving nothing, which matters a lot here:
 * in Starlight's built CSS every single `.sl-markdown-content` rule is inside
 * a layer block, so layer descent is the difference between this tier
 * working and being an empty string.
 */
export const ProseFilterDescendsCascadeLayers: Story = {
  render: () => <p data-testid="layer-filter-probe">cascade layer filter</p>,
  play: async () => {
    const sheet = [
      // The statement form every real Starlight/Tailwind sheet opens with. It
      // reports the same `type` as a layer BLOCK but exposes `nameList`, not
      // `cssRules` — mistaking it for a group throws inside the walker, and
      // that throw is swallowed into an empty tier.
      '@layer properties,base,starlight,theme,components,utilities;',
      '@layer starlight.content{',
      '.sl-markdown-content h2:not(:where(.not-content *)){font-size:2.1875rem}',
      'h2{font-size:60px}',
      '@media (min-width:50em){.sl-markdown-content h3{font-size:1rem}h3{font-size:70px}}',
      '}',
      '.sl-markdown-content p{margin-top:1rem}',
    ].join('');

    const out = filterProseSurfaceCss(sheet, 'sl-markdown-content');

    // Non-empty is the statement-form regression guard: the walker throwing on
    // `@layer a, b;` would surface as exactly this, an empty sheet.
    expect(out).not.toBe('');

    // Layer-nested rules survive, and the layer wrapper does NOT — the tier is
    // injected unlayered so it can beat the editor's unlayered prose defaults.
    expect(out).not.toMatch(/@layer/);
    expect(out).toContain('2.1875rem');
    expect(out).toContain('@media');
    expect(out).toContain('.sl-markdown-content h3');

    // Unscoped rules die at every depth, including inside a layer and inside a
    // conditional group nested in one.
    expect(out).not.toContain('60px');
    expect(out).not.toContain('70px');

    const tag = document.createElement('style');
    tag.media = 'not all';
    tag.textContent = out;
    document.head.appendChild(tag);
    try {
      const rules = Array.from(tag.sheet?.cssRules ?? []);
      expect(
        rules
          .filter((rule): rule is CSSStyleRule => rule.type === 1)
          .map((rule) => rule.selectorText.replace(/,\s*/g, ', ')),
      ).toEqual(['.sl-markdown-content h2:not(:where(.not-content *))', '.sl-markdown-content p']);
      // Exactly one conditional group survived, and nothing else at top level.
      expect(rules.filter((rule) => rule.type === 4)).toHaveLength(1);
      expect(rules).toHaveLength(3);
    } finally {
      tag.remove();
    }
  },
};

/**
 * Flattening preserves DECLARED layer order, not emission order.
 *
 * This is the one risk flattening actually takes on, and a Starlight-shaped
 * fixture cannot catch it: that sheet declares its sublayers and then emits
 * them in the same order, so flattening is a provable no-op for precedence.
 * Real Astro output does not have that property — a built Starlight page's
 * CSS can emit `@layer starlight.components` BEFORE `@layer starlight.content`
 * while its declaration puts components AFTER content. Flattening on source
 * order silently inverts any property those two both set on the same element.
 *
 * So state the inversion directly: `late` is declared after `early` but
 * emitted before it. The kept rules must come out in DECLARED order, so the
 * winner (`late`) is last and wins on source order once unlayered.
 */
export const ProseFilterPreservesDeclaredLayerOrder: Story = {
  render: () => <p data-testid="layer-order-probe">declared layer order</p>,
  play: async () => {
    const sheet = [
      '@layer early,late;',
      '@layer late{.sl-markdown-content h2{font-size:99px}}',
      '@layer early{.sl-markdown-content h2{font-size:11px}}',
    ].join('');

    const out = filterProseSurfaceCss(sheet, 'sl-markdown-content');
    expect(out.indexOf('11px')).toBeGreaterThanOrEqual(0);
    expect(out.indexOf('99px')).toBeGreaterThan(out.indexOf('11px'));

    // And the winner actually paints: 99px, the later-DECLARED layer, not the
    // 11px rule that happened to be emitted last.
    const host = document.createElement('div');
    host.className = 'sl-markdown-content';
    const heading = document.createElement('h2');
    host.append(heading);
    document.body.append(host);
    const tag = document.createElement('style');
    tag.textContent = out;
    document.head.appendChild(tag);
    try {
      expect(getComputedStyle(heading).fontSize).toBe('99px');
    } finally {
      tag.remove();
      host.remove();
    }
  },
};

/**
 * The computed-style probe outranks the derived bridge.
 *
 * Both fill the same `--conloca-host-*` typography contract, and the bridge
 * writes INLINE properties on `<html>` while the probe emits a `:root` rule —
 * so without an explicit gate the bridge wins purely because inline outranks a
 * stylesheet. That would silently supersede the probe on a same-origin site,
 * where it works and where it is strictly better: it measures the real rendered
 * page instead of deriving from a stylesheet.
 *
 * `--conloca-host-body-bg` is gated with the rest. It may look exempt, as if
 * the probe never published it — but `buildProbeStylesheet` emits it as a
 * `:root` rule, so an ungated inline write would collide with it and latch a
 * stale paper under the probe's ink.
 * Gating drops no same-origin surround to `transparent`: where the probe runs,
 * its own rule paints the region.
 */
function BridgeGateHarness({ bridgeHostVars }: { bridgeHostVars: boolean }) {
  useInjectHostStyles('conloca-host-preview', [ROUTE_CSS], {
    scopeSelector: '.conloca-mdx-editor-surround',
    bridgeHostVars,
  });
  return <div className="conloca-mdx-editor-surround dark" data-theme="dark" style={{ height: 40 }} />;
}

const BRIDGED_TYPOGRAPHY_VARS = [
  '--conloca-host-font-family',
  '--conloca-host-font-size',
  '--conloca-host-line-height',
  '--conloca-host-color',
] as const;

const readHostVars = () =>
  Object.fromEntries(
    BRIDGED_TYPOGRAPHY_VARS.map((name) => [name, document.documentElement.style.getPropertyValue(name)]),
  );

export const ProbeOutranksTheDerivedBridge: Story = {
  render: () => <BridgeGateHarness bridgeHostVars={false} />,
  play: async ({ canvasElement }) => {
    await waitForElement<HTMLElement>(canvasElement, '.conloca-mdx-editor-surround', 'surround');
    // The bridge runs on a requestAnimationFrame; give it several to land.
    await delay(300);

    // Every variable the probe also writes must be left alone, exactly.
    expect(readHostVars()).toEqual({
      '--conloca-host-font-family': '',
      '--conloca-host-font-size': '',
      '--conloca-host-line-height': '',
      '--conloca-host-color': '',
    });
    // …and the paper the probe never publishes must stay unset too, so the
    // platform pairing (light card, dark ink) holds together.
    expect(document.documentElement.style.getPropertyValue('--conloca-host-prose-bg')).toBe('');

    // The surround paint is the regression this gate exists for: the probe
    // publishes it as a `:root` rule, so an inline value here would outrank
    // that rule for the life of the document.
    expect(document.documentElement.style.getPropertyValue('--conloca-host-body-bg')).toBe('');
  },
};

/** The other direction: with no probe, the bridge is the only producer and
 * must fill the whole contract. */
export const BridgeFillsTheContractWhenNoProbe: Story = {
  render: () => <BridgeGateHarness bridgeHostVars={true} />,
  play: async ({ canvasElement }) => {
    await waitForElement<HTMLElement>(canvasElement, '.conloca-mdx-editor-surround', 'surround');
    await delay(300);

    const vars = readHostVars();
    expect(vars['--conloca-host-font-family']).toMatch(/Inter/);
    expect(vars['--conloca-host-line-height']).toBe('28px');
    expect(vars['--conloca-host-color']).toBe('rgb(226, 232, 240)');
    expect(document.documentElement.style.getPropertyValue('--conloca-host-prose-bg')).toBe('rgb(2, 6, 23)');
    expect(document.documentElement.style.getPropertyValue('--conloca-host-body-bg')).toBe('rgb(2, 6, 23)');
  },
};

/**
 * Typing in the real editor reaches the markdown it serializes, survives the
 * editor being closed and reopened, and stays readable in both admin themes
 * against a host that ships a palette for each. The boundary is the editor's
 * `onChange`: no save request or backend persistence is involved.
 */
export const EditingSurvivesRemountAndThemeChanges: Story = {
  render: () => <EmbeddedEditorHarness themeControls />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const marker = 'typed after the host styles landed';
    const editable = await waitForElement<HTMLElement>(canvasElement, '.conloca-prose--editor', 'initial editor');
    expect(editable.textContent).not.toContain(marker);
    expect(canvas.getByTestId('serialized-markdown').textContent).not.toContain(marker);
    await userEvent.click(canvas.getByRole('button', { name: 'Use dark theme' }));
    await waitFor(() => expect(paintedBackground(editable)).toBe('rgb(2, 6, 23)'), { timeout: 15000 });
    const paragraph = await waitForElement<HTMLElement>(editable, 'p', 'initial paragraph');
    await userEvent.click(paragraph);
    await userEvent.keyboard(` ${marker}`);
    await waitFor(() => expect(canvas.getByTestId('serialized-markdown').textContent).toContain(marker), {
      timeout: 15000,
    });

    await userEvent.click(canvas.getByRole('button', { name: 'Close editor' }));
    await waitFor(() => expect(editable.isConnected).toBe(false), { timeout: 15000 });
    expect(canvasElement.querySelector('.conloca-prose--editor')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Reopen editor' }));
    const reopened = await waitForElement<HTMLElement>(canvasElement, '.conloca-prose--editor', 'reopened editor');
    expect(reopened).not.toBe(editable);
    await waitFor(() => expect(reopened.textContent).toContain(marker), { timeout: 15000 });
    expect(reopened.querySelector('h2')?.textContent).toBe('Heading two sample');
    expect(reopened.querySelector('code')?.textContent).toBe('inline code');

    for (const theme of ['light', 'dark'] as const) {
      await userEvent.click(canvas.getByRole('button', { name: `Use ${theme} theme` }));
      await waitFor(
        () => {
          const current = canvasElement.querySelector<HTMLElement>('.conloca-prose--editor');
          const heading = current?.querySelector('h2');
          if (!current || !heading) throw new Error('Editor disappeared during theme change');
          expect(canvas.getByTestId('surround').dataset.theme).toBe(theme);
          expect(getComputedStyle(current).color).toBe(theme === 'light' ? 'rgb(51, 65, 85)' : 'rgb(226, 232, 240)');
          expect(getComputedStyle(heading).color).toBe(theme === 'light' ? 'rgb(23, 37, 84)' : 'rgb(248, 250, 252)');
          expect(paintedBackground(current)).toBe(theme === 'light' ? 'rgb(248, 250, 252)' : 'rgb(2, 6, 23)');
          expect(getComputedStyle(document.documentElement).colorScheme).toBe(theme);
          expect(getComputedStyle(canvas.getByTestId('admin-chrome-heading')).color).toBe(
            theme === 'light' ? 'rgb(24, 24, 24)' : 'rgb(250, 250, 250)',
          );
          expect(current.textContent).toContain(marker);
        },
        { timeout: 15000 },
      );
    }
  },
};
