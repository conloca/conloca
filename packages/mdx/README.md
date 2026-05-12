# @conloca/mdx

Universal MDX package for both browser and Node.js environments.

## What's included

### Browser-safe exports (`@conloca/mdx`)

- **MDXEditor** - Embeddable MDX editor component (the page-route editor in the CMS SPA uses this directly)
- **BaseMDXEditor** - Lower-level editor primitive that accepts the image-dialog hook used by the CMS SPA's
  media-library integration
- **useMDXEvaluation** - Hook for running pre-compiled MDX code in the browser

If you are building inside `@conloca/cms-spa`, prefer `CMSMDXEditor` there for the integrated media-library image
picker.

> **Note:** The legacy `MDXEditorModal` / `BaseMDXEditorModal` exports were removed when the CMS SPA standardized on the
> page-route editor (`/blocks/:id`, `/pages/:id`). Mount `MDXEditor` directly inside your own layout instead of nesting
> it in a fullscreen modal.

### Node.js-only exports (`@conloca/mdx/node`)

- **compileMDX** - Compile MDX strings to JavaScript
- **evaluateMDXToComponent** - Evaluate MDX strings to React components (server-side)
- **evaluateMDXBlocks** - Fetch and evaluate MDX blocks from a compatible content API

## Usage

### Browser (Client-side)

```typescript
// In admin/CMS interface
import { MDXEditor } from '@conloca/mdx';

// For rendering MDX content
import { useMDXEvaluation } from '@conloca/mdx';
```

### Node.js (Server-side)

```typescript
// In Astro, Next.js, etc.
import { evaluateMDXBlocks, evaluateMDXToComponent } from '@conloca/mdx/node';
import { createContentAPI } from '@conloca/content-api/node';

// Evaluate all MDX blocks for a locale
const api = await createContentAPI({ contentRoot: './content' });
const mdxComponents = await evaluateMDXBlocks(api, 'en');

for (const block of mdxComponents) {
  if (!block.ok) {
    console.error(`Failed to evaluate ${block.id}:`, block.error.message);
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
// when the CMS standardized on page-route editing at `/blocks/:id` / `/pages/:id`).
import { MDXEditor } from '@conloca/mdx';
```

The new `MDXEditor` is a component, not a modal — host it inside your own page layout (header, toolbar, save button) and
pass `value` / `onChange` directly. See the **Browser: MDX Editor** usage example above for the shape.

**Server-side functions moved here:**

```typescript
// Before (scattered across packages)
import { evaluateMDXToComponent } from '@conloca/content-api/node';
import { evaluateMDXBlocks } from '@conloca/astro-cms/components';

// After
import { evaluateMDXBlocks, evaluateMDXToComponent } from '@conloca/mdx/node';

// Also re-exported from Astro helpers when you are already working there
import { evaluateMDXBlocks } from '@conloca/astro-cms/components';
```

## Building

Run `nx build @conloca/mdx` to build the library.
