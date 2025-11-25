# @conloca/mdx

Universal MDX package for both browser and Node.js environments.

## What's included

### Browser-safe exports (`@conloca/mdx`)

- **MDXEditorModal** - Full MDX editor component with UI (for admin/CMS use)
- **useMDXEvaluation** - Hook for evaluating MDX strings into React components (for rendering)

### Node.js-only exports (`@conloca/mdx/node`)

- **compileMDX** - Compile MDX strings to JavaScript
- **evaluateMDXToComponent** - Evaluate MDX strings to React components (server-side)
- **evaluateMDXBlocks** - High-level helper for fetching and evaluating all blocks from Content API

## Usage

### Browser (Client-side)

```typescript
// In admin/CMS interface
import { MDXEditorModal } from '@conloca/mdx';

// For rendering MDX content
import { useMDXEvaluation } from '@conloca/mdx';
```

### Node.js (Server-side)

```typescript
// In Astro, Next.js, etc.
import { evaluateMDXToComponent, evaluateMDXBlocks } from '@conloca/mdx/node';
import { createContentAPI } from '@conloca/content-api/node';

// Evaluate all MDX blocks for a locale
const api = await createContentAPI({ contentRoot: './content' });
const mdxComponents = await evaluateMDXBlocks(api, 'en');

// Or evaluate a single MDX string
const { Component, error } = await evaluateMDXToComponent('# Hello World');
```

## Migration from @conloca/mdx-client

This package was renamed from `@conloca/mdx-client` to `@conloca/mdx` and consolidated all MDX operations.

**Update your imports:**

```typescript
// Before
import { MDXEditorModal } from '@conloca/mdx-client';

// After
import { MDXEditorModal } from '@conloca/mdx';
```

**Server-side functions moved here:**

```typescript
// Before (scattered across packages)
import { evaluateMDXToComponent } from '@conloca/content-api/node';
import { evaluateMDXBlocks } from '@conloca/astro-cms/components';

// After (all in one place)
import { evaluateMDXToComponent, evaluateMDXBlocks } from '@conloca/mdx/node';
```

## Building

Run `nx build @conloca/mdx` to build the library.
