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

### Node.js-only exports (`@conloca/mdx/node`)

- **compileMDX** - Compile MDX strings to JavaScript
- **evaluateMDXToComponent** - Evaluate MDX strings to React components (server-side)
- **evaluateMDXFragments** - Fetch and evaluate MDX fragments from a compatible content API
- **handleMDXCompileRequest** - Answer the editor's `POST /mdx/compile` request with the whole compile result

### Sandboxed preview exports (`@conloca/mdx/sandbox-frame`)

Compiled MDX is evaluated in an opaque-origin iframe, never in the page that hosts the editor.

- **buildSandboxSrcdoc** - Build the preview frame's HTML document, with its runtime inlined
- **SANDBOX_FRAME_CSP** - The content-security policy that confines the MDX evaluation to that frame
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
the compiled MDX to the frame. A built site can ship `buildSandboxSrcdoc()` as a static file instead; without the
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
frame.contentWindow?.postMessage({ __conlocaSandbox: true, kind: 'render', mode: 'mdx', payload: compiledMdx }, '*');
```

An image `src` the opaque-origin frame cannot load itself, such as an unpublished upload, can travel in the optional
`images` field of the render message: a map from that `src`, exactly as the compiled MDX names it, to a `data:` URL. The
frame shows the data URL in place of a matching `<img>` `src` and leaves every other `src` alone. Blob URLs do not work
here, because the frame's origin cannot read the host page's blobs.

```typescript
frame.contentWindow?.postMessage(
  {
    __conlocaSandbox: true,
    kind: 'render',
    mode: 'mdx',
    payload: compiledMdx,
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

### Node.js (Server-side)

```typescript
// In Astro, Next.js, etc.
import { evaluateMDXFragments, evaluateMDXToComponent } from '@conloca/mdx/node';
import { createContentAPI } from '@conloca/content-api/node';

// Evaluate all MDX fragments for a locale
const api = await createContentAPI({ contentRoot: './content' });
const mdxComponents = await evaluateMDXFragments(api, 'en');

for (const fragment of mdxComponents) {
  if (!fragment.ok) {
    console.error(`Failed to evaluate ${fragment.id}:`, fragment.error.message);
  }
}

// Or evaluate a single MDX string
const { Component, error } = await evaluateMDXToComponent('# Hello World');
```

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
