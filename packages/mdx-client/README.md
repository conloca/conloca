# @conloca/mdx-client

Client-side MDX functionality for editing and rendering.

## What's included

- **MDXEditorModal** - Full MDX editor component with UI (for admin/CMS use)
- **useMDXEvaluation** - Hook for evaluating MDX strings into React components (for rendering)
- **All MDX dependencies** - @mdx-js/mdx, @mdx-js/react, @mdxeditor/editor, remark plugins

## Usage

```typescript
// In admin/CMS interface
import { MDXEditorModal } from '@conloca/mdx-client';

// For rendering MDX content
import { useMDXEvaluation } from '@conloca/mdx-client';
```

## Building

Run `nx build @conloca/mdx-client` to build the library.
