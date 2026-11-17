# @conloca/mdx

Universal MDX package for both browser and Node.js environments.

## What's included

### Browser-safe exports (`@conloca/mdx`)

- **MDXEditor** - Embeddable MDX editor component (the page-route editor in the CMS SPA uses this directly)
- **BaseMDXEditor** - Lower-level editor primitive that accepts the image-dialog hook used by the CMS SPA's
  media-library integration, and an optional `imagePreviewHandler(src) => Promise<string>` that maps an image's `src` to
  the URL the editor canvas shows (for example an object URL of unpublished bytes); the saved markdown keeps the
  original `src`
- **codeBlockWrapperInfo$** - Editor realm cell a host publishes so the editor's fenced code blocks inherit the host
  site's own code-block classes

If you are building inside `@conloca/cms-spa`, prefer `CMSMDXEditor` there for the integrated media-library image
picker.

> **Note:** The legacy `MDXEditorModal` / `BaseMDXEditorModal` exports were removed when the CMS SPA standardized on the
> page-route editor (`/fragments/:id`, `/pages/:id`). Mount `MDXEditor` directly inside your own layout instead of
> nesting it in a fullscreen modal.

### Render exports (`@conloca/mdx/render`)

The fragment renderer and its checks. This entry loads where code generation from strings is forbidden (Cloudflare
Workers, a strict CSP): it imports no editor code and no Node.js APIs, and it never evaluates fragment content.

- **evaluateMDXToComponent(mdx, vocabulary?)** - Render a fragment to a React component with the site's components
- **defineFragmentComponents({ components, elements, outline })** - Declare the components and element overrides
  fragments may use (the vocabulary), and which components are contents entries
- **findUnknownFragmentComponents(mdx, names)** - The component tags in `mdx` that `names` does not declare, with lines
- **checkFragmentMdx(mdx, names, propSpecs)** - Why the renderer would refuse or change `mdx`, or `undefined`; also
  checks declared prop types
- **fragmentComponentProps(attributes)** - The props a published component receives for its parsed attributes
- **parseFragmentMdx(mdx)** - The renderer's syntax tree for `mdx`, before any transform
- **isFragmentVocabulary**, **isFragmentComponentName**, **EMPTY_FRAGMENT_VOCABULARY**, **FRAGMENT_ELEMENT_NAMES** -
  Vocabulary guards and constants

### Node.js-only exports (`@conloca/mdx/node`)

- **evaluateMDXFragments(api, locale, vocabulary?)** - Fetch and evaluate MDX fragments from a compatible content API
- Re-exports `evaluateMDXToComponent`, `defineFragmentComponents` and the vocabulary guards from `@conloca/mdx/render`

### Sandboxed preview exports (`@conloca/mdx/sandbox-frame`)

Sanitized HTML is rendered in an opaque-origin iframe, never in the page that hosts the editor.

- **buildSandboxSrcdoc** - Build the preview frame's HTML document, with its runtime inlined
- **SANDBOX_FRAME_CSP** - The frame's content-security policy: inline scripts but no `eval`, and no `connect-src`
- **MDX_SANDBOX_FRAME_POLICY** - The policy a server sends with the frame document: `SANDBOX_FRAME_CSP` plus
  `sandbox allow-scripts` and `frame-ancestors 'self'`, which a meta policy cannot carry
- **SANDBOX_FRAME_PATH** - The path a dev server serves the frame document from
- **SandboxRenderMessage** / **SandboxOutboundMessage** - The messages the host and the frame exchange

## Usage

### Browser (Client-side)

```typescript
// In admin/CMS interface
import { MDXEditor } from '@conloca/mdx';
import '@conloca/mdx/style.css';
```

The editor entry ships no stylesheet in its JavaScript; import `@conloca/mdx/style.css` once, alongside it. It pulls
MDXEditor's own stylesheet in first, so that is the only stylesheet import a host writes.

### Browser (Preview)

In development, serve the frame document at `SANDBOX_FRAME_PATH` only to iframe loads, point an iframe at it, and post
the sanitized HTML to the frame. A built site can ship `buildSandboxSrcdoc()` as a static file instead; without the
response policy below the frame then relies on its own opaque-origin check, unless the site's headers send
`Content-Security-Policy: sandbox allow-scripts` for that file:

```typescript
import { buildSandboxSrcdoc, MDX_SANDBOX_FRAME_POLICY, SANDBOX_FRAME_PATH } from '@conloca/mdx/sandbox-frame';

// In the host's request handler for SANDBOX_FRAME_PATH
if (request.headers.get('sec-fetch-dest') !== 'iframe') {
  return new Response('The MDX preview frame loads only inside an editor frame.', {
    status: 403,
    headers: { 'cache-control': 'no-store' },
  });
}
return new Response(buildSandboxSrcdoc(), {
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': MDX_SANDBOX_FRAME_POLICY,
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  },
});

// In the host page, once the frame has posted `{ kind: 'ready' }`. The frame's
// origin is opaque, so '*' is the only target origin that reaches it.
frame.contentWindow?.postMessage({ __conlocaSandbox: true, kind: 'render', mode: 'html', payload: sanitizedHtml }, '*');
```

An image `src` the opaque-origin frame cannot load itself, such as an unpublished upload, can travel in the optional
`images` field of the render message: a map from that `src`, exactly as the HTML names it, to a `data:` URL. The frame
shows the data URL in place of a matching `<img>` `src` and leaves every other `src` alone. Blob URLs do not work here,
because the frame's origin cannot read the host page's blobs.

```typescript
frame.contentWindow?.postMessage(
  {
    __conlocaSandbox: true,
    kind: 'render',
    mode: 'html',
    payload: sanitizedHtml,
    images: { '/assets/hero.png': 'data:image/png;base64,…' },
  },
  '*'
);
```

`@conloca/astro-cms` serves this route under `astro dev`; `@conloca/cloud-astro` writes the static copy to
`/_conloca/editor/sandbox-frame.html` in builds. A host that mounts the editor itself has to serve it.

Browsers send `Sec-Fetch-Dest` only to `https` and `localhost` addresses. Under `astro dev --host`, opened at a
plain-HTTP LAN or IP address such as `http://192.168.1.20:4321/__cms`, the frame route answers 403 to every preview;
open the editor at `localhost` instead.

### Server: rendering fragments with the site's components

A site declares the components fragments may use, and the HTML elements it overrides, in one module:

```tsx
// src/fragment-components.tsx
import { defineFragmentComponents } from '@conloca/mdx/render';
import { Callout } from './components/Callout';
import { SectionHeading } from './components/SectionHeading';

export const fragmentComponents = defineFragmentComponents({
  components: { Callout },
  elements: { h2: SectionHeading },
});
```

Then renders a fragment with that vocabulary:

```typescript
import { evaluateMDXToComponent } from '@conloca/mdx/render';
import { fragmentComponents } from './fragment-components';

const { Component, error, outline } = await evaluateMDXToComponent(
  '## Plans\n\n<Callout tone="info">Prices include VAT.</Callout>',
  fragmentComponents
);
```

`evaluateMDXFragments` takes the same vocabulary for every fragment of a locale:

```typescript
import { createContentAPI } from '@conloca/content-api/node';
import { evaluateMDXFragments } from '@conloca/mdx/node';
import { fragmentComponents } from './fragment-components';

const api = await createContentAPI({ contentRoot: './content' });
for (const fragment of await evaluateMDXFragments(api, 'en', fragmentComponents)) {
  if (!fragment.ok) console.error(`Failed to evaluate ${fragment.id}:`, fragment.error.message);
}
```

Without a vocabulary both render Markdown and raw HTML only, and refuse every component.

The rules the renderer applies:

- **Components.** A tag whose name starts with a capital letter (or contains a dot) is a component, and comes only from
  `components`. A name the vocabulary does not declare, and any dotted name, is an error: `evaluateMDXToComponent`
  returns it in `error`, naming the tag. `defineFragmentComponents` throws for a key that is not a capitalized
  identifier, or a value that is not a React component.
- **Element overrides.** `elements` replaces the HTML elements a fragment's Markdown produces: `h1`–`h6`, `p`, `a`,
  `ul`, `ol`, `li`, `blockquote`, `hr`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `pre`, `code`, `img`, `strong`,
  `em` and `del`. Any other key throws.
- **JSON props.** A component's attribute values are JSON: strings, numbers, booleans, lists and plain objects, as in
  `<Card tags={["new", "sale"]} cta={{"href": "/pricing", "label": "See plans"}} />`. Values are parsed with
  `JSON.parse`, never evaluated. A value that is not JSON, or is `null`, and a `{...spread}` are not passed. String
  values with a `javascript:`, `vbscript:` or `data:text/html` URL are emptied at any depth inside lists and objects.
  Props whose names start with `on`, in any case, are never passed; rename them. Inside lists and objects, a key
  starting with `on`, in any case, is dropped at any depth when its value is a string (`"onboarding": "Welcome"`); other
  values under such keys are kept (`"online": true`).
- **Raw HTML.** Lowercase tags keep string, number and boolean attributes; other values are dropped, and so is every
  attribute whose name starts with `on`, in any case.
- **`style`** written by the author is dropped on every element and every component; the column alignment the renderer
  gives Markdown tables is kept.
- **No code.** `{…}` expressions (other than `{/* comments */}`) and `import`/`export` lines are an error.
  `checkFragmentMdx` reports the same refusals before a save, plus attribute values that are not JSON, spreads, and
  declared prop types that do not match.
- **Outline.** `outline` lists the fragment's Markdown headings, including those written between a component's tags,
  with the ids the renderer gave them. A heading the component itself renders is not in the outline.
- **Component outline.** `defineFragmentComponents`' `outline` option makes components contents entries: it maps a
  component name to the props that hold the anchor id and the contents text, as in
  `outline: { Section: { id: 'id', text: 'label' } }`. `componentOutline` then lists every such component in document
  order as `{ component, id, text }`, read from its props after the JSON-props rules above; one whose id or text is not
  a non-empty string is left out. It is a list of its own, so `outline` keeps only headings, and a generated heading id
  never takes a listed component's id. The component renders the id itself. `defineFragmentComponents` throws for an
  `outline` key that is not in `components`, or prop names that are not non-empty strings.

## Migration from @conloca/mdx-client

This package was renamed from `@conloca/mdx-client` to `@conloca/mdx` and consolidated all MDX operations.

**Update your imports:**

```typescript
// Before
import { MDXEditorModal } from '@conloca/mdx-client';

// After — mount the editor inline (the fullscreen-modal variant was removed
// when the CMS standardized on page-route editing at `/fragments/:id` / `/pages/:id`).
import { MDXEditor } from '@conloca/mdx';
```

The new `MDXEditor` is a component, not a modal — host it inside your own page layout (header, toolbar, save button) and
pass `value` / `onChange` directly. See the **Browser: MDX Editor** usage example above for the shape.

**Server-side functions moved here:**

```typescript
// Before (scattered across packages)
import { evaluateMDXToComponent } from '@conloca/content-api/node';
import { evaluateMDXFragments } from '@conloca/astro-cms/components';

// After
import { evaluateMDXFragments, evaluateMDXToComponent } from '@conloca/mdx/node';

// Also re-exported from Astro helpers when you are already working there
import { evaluateMDXFragments } from '@conloca/astro-cms/components';
```

## Building

Run `nx build @conloca/mdx` to build the library.
