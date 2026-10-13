# @conloca/mdx

Universal MDX package for both browser and Node.js environments.

## What's included

### Browser-safe exports (`@conloca/mdx`)

- **MDXEditor** - Embeddable MDX editor component (the page-route editor in the CMS SPA uses this directly)
- **BaseMDXEditor** - Lower-level editor primitive that accepts the image-dialog hook used by the CMS SPA's
  media-library integration
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
- **SANDBOX_FRAME_PATH** - The path a host serves the frame document from
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

Serve the frame document at `SANDBOX_FRAME_PATH`, point an iframe at it, and post the compiled MDX to the frame:

```typescript
import { buildSandboxSrcdoc, SANDBOX_FRAME_CSP, SANDBOX_FRAME_PATH } from '@conloca/mdx/sandbox-frame';

// In the host's request handler for SANDBOX_FRAME_PATH
new Response(buildSandboxSrcdoc(), {
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `${SANDBOX_FRAME_CSP}; frame-ancestors 'self'`,
  },
});

// In the host page, once the frame has posted `{ kind: 'ready' }`. The frame's
// origin is opaque, so '*' is the only target origin that reaches it.
frame.contentWindow?.postMessage({ __conlocaSandbox: true, kind: 'render', mode: 'mdx', payload: compiledMdx }, '*');
```

`@conloca/astro-cms` already serves this route; a host that mounts the editor itself has to serve it.

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
