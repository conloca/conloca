# Theming the Conloca editor

The CMS editor shows your content with your site's own CSS and wrappers. You don't write a separate theme for it —
Conloca discovers your site's CSS and applies it to the editor surface, then mirrors your content wrapper element around
the contenteditable so your selectors hit naturally. What that guarantees, and what it does not, is listed under
[What matches the published page](#what-matches-the-published-page).

This page documents the contract: which CSS your site can ship to influence the editor, what each piece controls, and
how to override anything that auto-discovery picks wrong.

## What matches the published page

- **The page canvas** renders fragments in place among the page's blocks, with your site's CSS and your fragment
  components (the `fragmentComponentsPath` module), inside the route's `editorFrame` when it declares one. Fragments
  there render with the same renderer as the published page, so element overrides and components look as published,
  within the frame you wrote. A route without a frame has no layout wrappers around its content in the canvas.
- **The fragment editor** renders each fragment component as your real React component. Markdown (headings, paragraphs,
  lists, tables) is editable text styled by your CSS through the discovery described below, so element overrides do not
  show while typing.
- **The live preview** beside the fragment editor renders the fragment with the published renderer, element overrides
  included, inside the `editorFrame` of the first routing entry that declares one, with `fragmentPreviewRoute` as its
  `pathname`.

## How discovery works

When the editor opens a doc at route `/foo/`:

1. **CSS fetch.** The integration hits `GET /__cms/api/styles?url=/foo/` which walks Vite's module graph from the
   `/foo/` route's entry point and returns every reachable stylesheet — Tailwind utilities, theme tokens, scoped
   `<style>` blocks from `.astro` components, you name it. The SPA injects those into the editor document under
   `@layer conloca-host-preview` so they apply to the editor surface.

2. **Content-wrapper mirroring.** A second request to `GET /__cms/api/content-wrapper?url=/foo/` parses the live page
   HTML and returns the host's content-root element shape (`{ tagName, className }`). The editor's MDXEditor plugin then
   renders the contenteditable inside a clone of that wrapper. Result: your `main.card { padding: 40px }` rule matches
   the editor's content surface the same way it matches the live page.

3. **Body bg bridge.** The editor's chrome paints its own grey, but the content surround needs to feel like your site's
   page background. `useInjectHostStyles` reads `getComputedStyle(body).backgroundColor` after host CSS lands and
   exposes it as `--conloca-host-body-bg` on `:root`, which the surround region reads.

On the editor page that `@conloca/cloud-astro` builds into your site, there is no dev server to ask. The editor loads
the published page at `/foo/` in a hidden same-origin frame and reads both facts from it: the page's own stylesheets
take the place of step 1, and the same wrapper rule runs on its HTML for step 2.

## Opt-ins

### Content-root marker

Conloca picks the host's content wrapper using this priority order:

1. **`[data-conloca-content-root]`** — pin this attribute on the element you want the editor to mirror. Wins over any
   heuristic.

```astro
<!-- Your Layout.astro -->
<article class="card" data-conloca-content-root>
  <slot />
</article>
```

2. **`<main>`** — the HTML5 default. If no marker is found, the editor mirrors the first `<main>` it sees. Works out of
   the box on Starlight, Astro Content Collections, and most layout templates.

3. **Nothing** — if there's no `<main>` either, the editor falls back to its chrome and doesn't mirror anything. The
   body-bg bridge still paints the surround.

You only need the explicit marker when:

- Your layout has multiple `<main>` elements (unusual).
- You want a different element to be the wrapper (eg `<section>` or `<article>`).
- Your wrapper has classes that matter for CSS targeting and you want them preserved verbatim (Astro scoped hashes
  survive when you mark explicitly).

#### Fragments carry the marker too

Every fragment Conloca renders — inside your own `ContentFragmentSection` block, or as a standalone fragment block —
comes wrapped in `<div class="mdx-content conloca-prose" data-conloca-content-root>`. That wrapper is a marked element
like any other, and the first marker in the document wins, so on a page that shows a fragment the editor mirrors the
fragment's wrapper instead of falling back to `<main>` or to the classed-wrapper heuristic. That is usually what you
want: the fragment is the prose on that page.

When it isn't, mark the element you'd rather have mirrored. A layout wrapper around the whole page body opens before any
fragment inside it, so it stays the first marker and keeps winning.

### CSS variables the editor reads

MDX content typography uses three layers, in the editor document's cascade order
`cms-admin, conloca-host-defaults, conloca-host-preview`:

1. **L0 — Conloca baseline** (`--conloca-prose-*`) — always on; readable default when host matching is unavailable.
2. **L1 — Host auto-match** — your discovered CSS sits in `conloca-host-preview`. The style probe measures your page's
   bare elements: a spacing, colour or typography value your discovered CSS already gives the editor goes in
   `conloca-host-defaults`, a fallback your own rules beat; values it does not reproduce (including the
   `--conloca-host-*` heading scale) stay unlayered, so they beat the editor's own prose scale.
3. **L2 — Consumer override** — `editorCSS` is appended to `conloca-host-preview` after the discovered CSS, so it wins
   over discovered CSS and over `conloca-host-defaults`, but not over the probe's unlayered values.

Anything you set on `:root` (or a more specific selector) can flow through. Host tokens the probe and Puck bridge
commonly pick up:

| Variable                                      | What it paints                    | Notes                                                     |
| --------------------------------------------- | --------------------------------- | --------------------------------------------------------- |
| `--font-sans`                                 | Preferred body font when mirrored | Used by Puck iframe bridge; optional for MDX via host CSS |
| `--font-mono`                                 | Code font                         | Host CSS / code blocks                                    |
| `--conloca-host-font-family`                  | MDX contenteditable font          | Set by probe when preview works                           |
| `--conloca-host-color`                        | MDX contenteditable text color    | Set by probe when preview works                           |
| `--conloca-prose-font-family`                 | MDX baseline font                 | Override the L0 default without a full host match         |
| `--conloca-prose-color`                       | MDX baseline text color           | Override the L0 default                                   |
| `--conloca-code-bg` / `--conloca-code-border` | Code chrome                       | Optional host overrides                                   |

Admin light/dark (`conloca-theme`) is separate from your public site theme. The probe mirrors the **admin** resolved
scheme so typing stays coherent in the editor; it does not sticky-store your brand font across sessions.

## Integration options

These go in `astro.config.mjs`:

```ts
import { conlocaCMS } from '@conloca/astro-cms/node';

export default defineConfig({
  integrations: [
    conlocaCMS({
      contentRoot: './content',
      puckConfigPath: './src/puck.config.tsx',

      // Route URL the FRAGMENT editor uses for style + wrapper discovery.
      // Defaults to `/` (site root). Pick a representative content page
      // — typically the same page type your fragments will be embedded in.
      fragmentPreviewRoute: '/getting-started/',

      // Raw CSS injected into the editor's `conloca-host-preview` layer
      // AFTER auto-discovered host CSS. Use for one-off overrides when
      // auto-discovery picks wrong (gradient bg you don't want in the
      // editor, accessibility tweaks, etc).
      editorCSS: `
        body { background: #0a0a1f; }
        .conloca-prose--editor { font-size: 1.0625rem; }
      `,
    }),
  ],
});
```

### `fragmentPreviewRoute`

Fragments aren't tied to a single route, so the fragment editor needs a route to synthesize its preview from. Pick a
representative content page on your site — typically one that uses the same layout style your fragments will end up in.
It is also the `pathname` the live preview hands to the editor frame, so a frame that varies by path (for example one
that adds an article wrapper under `/blog/`) shows the wrappers of that page.

Hosts that ship rich typography (custom prose styles, code blocks, custom list markers) see the biggest benefit. Hosts
whose body bg matches the editor chrome can leave this on the default.

### `editorCSS`

Pure raw CSS. Conloca does no scoping or transformation — your selectors are applied verbatim. The CSS lives in
`@layer conloca-host-preview`, which sits ABOVE `@layer cms-admin` in the cascade. That means:

- Your CSS wins over auto-discovered host CSS (same layer, later position).
- Your CSS still LOSES to admin chrome (different layer, ordered after).

In practice that's exactly what you want: override the host paint, don't fight the editor toolbar.

## Common recipes

### Force a specific surround color regardless of body bg

```ts
conlocaCMS({
  editorCSS: 'body { background: #0a0a1f; }',
});
```

### Disable the host-wrapper mirror (use the editor's chrome instead)

Don't mark a content root, and ensure your layout doesn't have a `<main>`. The editor falls back to its chrome and
doesn't mirror anything.

### Per-component editor-only tweak

Components carry their original class names in the editor, so target them directly:

```ts
conlocaCMS({
  editorCSS: `
    /* Lighten Asides only inside the editor — published page unchanged. */
    .starlight-aside { opacity: 0.95; }
  `,
});
```

## When auto-discovery isn't enough

If you find yourself fighting the editor's appearance:

1. **Inspect the editor.** Look at the actual element with devtools — what class is it rendering with? Is
   `--conloca-host-body-bg` set on `:root`? Most "why doesn't this work" questions resolve here.

2. **Check the layer order.** Open the elements panel, look at the "Computed" tab → "Properties". Anything in
   `cms-admin` is the editor's own chrome; anything in `conloca-host-preview` is your CSS (auto- discovered or via
   `editorCSS`).

3. **File the gap.** If the contract above is missing a knob you genuinely need, open an issue. The pattern of
   "introduce a new var Conloca reads" is small and we'd rather extend the contract than have you write `!important`
   hacks.
