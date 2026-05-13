# @conloca/astro-cms

A developer-focused CMS for Astro that runs exclusively in development mode. This CMS provides a visual interface for
managing content using Puck's drag-and-drop editor, allowing developers to create and edit pages visually while
maintaining full control over their content structure. The CMS integrates seamlessly into your Astro development
workflow, accessible at `/__cms` routes without requiring authentication or complex setup.

## MDX component registry

Hosts can register JSX components (their own, or third-party ones like Starlight's `<Steps>`, `<Tabs>`, `<Card>`) with
the MDX editor so authors get typed insert affordances and optional auto-import injection. The registry is wired through
the same `schemasPath` option that already loads `pageSchemas` — add an `mdxComponents` export to the file and the CMS
picks it up at boot (and on HMR).

```ts
// src/schemas.ts
import { defineMdxComponents } from '@conloca/astro-cms';

export const pageSchemas = {
  /* existing entries */
};

export const mdxComponents = defineMdxComponents([
  {
    name: 'Steps',
    kind: 'flow',
    hasChildren: true,
    insert: { label: 'Steps', description: 'Numbered step-by-step list', icon: 'list-ordered' },
    defaults: { children: '1. First step\n2. Second step\n3. Third step' },
    import: { from: '@astrojs/starlight/components' },
  },
  // …other components your site uses
]);
```

Starlight components are declared the same way as any other component — the CMS does not ship Starlight descriptors.
Copy the props you need from each component's source (e.g.
`node_modules/@astrojs/starlight/user-components/<Component>.astro`).

In the editor, registered components appear in two places:

- A slash menu, opened by typing `/` in the body. Filter by name, label, description, or keywords.
- A toolbar dropdown next to the admonition button, listing block-level (`kind: 'flow'`) components.

### Auto-import injection (and its pruning caveat)

Setting `import: { from: '<module>' }` on a descriptor opts the component into automatic import injection: whenever the
component appears in the document, the CMS save serializer emits the matching `import { Name } from '<module>'` line at
the top of the file (after frontmatter).

**Important: the editor rebuilds the import block on every save from components actually referenced in the tree.**
Imports for unused components are dropped. So are non-JSX imports — type imports, side-effect imports
(`import './styles.css'`), and helper-function imports — because the editor does not consider them "referred to" by a
JSX node. This is a hard constraint of the underlying `@mdxeditor/editor` export pipeline
([`exportMarkdownFromLexical.js:98-148`](../../node_modules/@mdxeditor/editor/dist/exportMarkdownFromLexical.js)), not a
policy choice.

For Starlight-flavored docs (where MDX only imports Starlight components from `@astrojs/starlight/components`) the
behavior matches authorial intent — imports follow usage. For richer MDX that relies on type or side-effect imports,
edit those files in your IDE rather than the CMS, or omit `import.from` from your descriptors so the editor does not
claim ownership of the import line.

## How Astro Integrations Are Built

Based on research of official Astro integrations:

### Build Tools Used

1. **astro-scripts** - Official Astro integrations use `astro-scripts` for building:

   ```json
   {
     "scripts": {
       "build": "astro-scripts build \"src/**/*.ts\" && tsc",
       "build:ci": "astro-scripts build \"src/**/*.ts\""
     }
   }
   ```

2. **TypeScript Compilation** - Standard `tsc` for type definitions:
   - Compiles `.ts` files to `.js`
   - Generates `.d.ts` type definitions
   - Does NOT compile `.astro` files

3. **Package Exports** - Modern ESM exports in package.json:
   ```json
   {
     "exports": {
       ".": "./dist/index.js",
       "./package.json": "./package.json"
     }
   }
   ```

### How Integrations Ship UI

Official integrations handle UI in several ways:

1. **API Endpoints Only** (Most common)
   - Example: `@astrojs/web-vitals` injects API routes
   - No UI components shipped

2. **Client-Side Scripts** (Common)
   - Example: Dev toolbar integrations
   - Ship JavaScript that runs on the client
   - Injected via `injectScript()`

3. **Middleware Approach** (Common)
   - Example: `@astrojs/node` adds Express middleware
   - Serves content programmatically

4. **Virtual Modules** (Advanced)
   - Example: `@astrojs/db` uses virtual modules
   - Routes are generated at build time
   - Uses Vite's virtual module system

### Building Non-Standard Integrations

For integrations that need to ship actual UI:

1. **Custom Build Process**
   - Can use any build tool (Vite, Rollup, esbuild)
   - Not limited to `tsc` only
   - Example: Bundle React app and serve via middleware

2. **Asset Handling**
   - Static assets can be included in the package
   - Served via middleware or virtual modules
   - Example: CSS files, images, bundled JavaScript

3. **Route Injection Patterns**

   ```typescript
   // Inject API routes (standard)
   injectRoute({
     pattern: '/api/[...path]',
     entrypoint: '@my-pkg/api-handler',
   });

   // Inject catch-all for SPA (for client routing)
   injectRoute({
     pattern: '/__cms/[...path]',
     entrypoint: '@my-pkg/spa-handler',
   });
   ```

### Shipping .astro Files (Possible but Rare)

While uncommon, packages CAN ship .astro files:

```json
{
  "exports": {
    "./pages/index.astro": "./src/pages/index.astro"
  }
}
```

However, this requires:

- Including source .astro files in npm package
- Proper export configuration
- User's Astro instance compiles them at build time

### For This CMS

Given the requirements:

- React-based UI (Puck editor)
- Client-side routing needed
- Development-only usage

The optimal approach is:

1. Build the CMS as a Vite-based React SPA
2. Bundle it during package build
3. Serve via middleware with catch-all routing
4. Use Astro's API routes for data endpoints

This aligns with how tools like Vite's dev UI and other development tools integrate with build systems.

## Research: Using .astro Components in React/Puck

Based on investigation of Astro's source code, here's what was discovered about rendering .astro components within
React:

### How .astro Components Work

1. **Compilation Process**
   ([astro/packages/astro/src/vite-plugin-astro/compile.ts](https://github.com/withastro/astro/blob/main/packages/astro/src/vite-plugin-astro/compile.ts)):
   - .astro files are transformed by `@astrojs/compiler` into TypeScript/JavaScript
   - The output is an `AstroComponentFactory` function, not a React component
   - Components include metadata for hydration, slots, and server-side rendering

2. **Component Factory Structure**
   ([astro/packages/astro/src/runtime/server/render/astro/factory.ts](https://github.com/withastro/astro/blob/main/packages/astro/src/runtime/server/render/astro/factory.ts)):

   ```typescript
   interface AstroComponentFactory {
     (result: any, props: any, slots: any): AstroFactoryReturnValue;
     isAstroComponentFactory?: boolean;
     moduleId?: string;
     propagation?: PropagationHint;
   }
   ```

3. **Container API**
   ([astro/packages/astro/src/container/index.ts](https://github.com/withastro/astro/blob/main/packages/astro/src/container/index.ts)):
   - Provides `experimental_AstroContainer` for programmatic rendering
   - Can render .astro components to HTML strings via `renderToString()`
   - Server-side only - returns static HTML, not React components

### Rendering .astro Components

The Container API allows server-side rendering of .astro components:

```typescript
// Example from astro/examples/container-with-vitest/test/ReactWrapper.test.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { getContainerRenderer } from '@astrojs/react';
import Component from '../src/components/Component.astro';

const container = await AstroContainer.create({
  renderers: [getContainerRenderer()],
});

const html = await container.renderToString(Component, {
  props: {
    /* component props */
  },
  slots: { default: 'Slot content' },
});
```

### Integration Approaches

#### 1. Server-Side HTML Rendering (Limited)

- Render .astro components to HTML strings server-side
- Display in React using `dangerouslySetInnerHTML`
- No client-side interactivity preserved
- Requires API endpoint to render components on demand

#### 2. Astro Islands Architecture ([astro/packages/astro/src/runtime/server/astro-island.ts](https://github.com/withastro/astro/blob/main/packages/astro/src/runtime/server/astro-island.ts))

- Astro uses custom `<astro-island>` elements for hydration
- Complex hydration system with directives (`client:load`, `client:idle`, etc.)
- Not designed for embedding within React components
- Would require significant work to integrate with React's lifecycle

#### 3. Direct Component Usage (Not Possible)

- .astro components cannot be directly imported and used as React components
- Different component models: Astro uses server-first rendering with partial hydration
- React expects components that return React elements

### Recommendation

**Use React components in Puck, not .astro components:**

1. Create shared React components that can be used by both:
   - Astro pages (via React integration)
   - Puck editor (native React)

2. Example structure:

   ```
   src/
     components/
       Hero.tsx          # React component
       Card.tsx          # React component
     pages/
       index.astro       # Uses React components
     puck.config.ts      # Also uses React components
   ```

3. Benefits:
   - Full interactivity in the CMS
   - Consistent behavior between CMS preview and production
   - No complex wrapping or conversion needed
   - Proper TypeScript support and props validation

### Technical Constraints

Based on the source code analysis:

1. **No React Wrapper Exists**: Astro doesn't provide a way to wrap .astro components for use in React
2. **Different Rendering Models**: Astro's server-first, partial hydration model is incompatible with React's
   client-side model
3. **Container API Limitations**: Only provides server-side rendering to HTML strings, not interactive components

### Conclusion

While .astro components excel at server-side rendering with selective hydration, they cannot be meaningfully wrapped as
React components for use in Puck. The recommended approach is to use React components throughout the Puck configuration,
which can also be used in Astro pages via the React integration.

## Astro Development Mode and HMR

### How Astro Handles Hot Module Replacement

Based on analysis of the Astro source code:

1. **Compilation Pipeline**
   ([astro/packages/astro/src/vite-plugin-astro/index.ts](https://github.com/withastro/astro/blob/main/packages/astro/src/vite-plugin-astro/index.ts)):
   - `@astrojs/compiler` transforms .astro files into JavaScript
   - `vite-plugin-astro` orchestrates this compilation
   - The plugin integrates with Vite's module system

2. **HMR Implementation**
   ([astro/packages/astro/src/vite-plugin-astro/hmr.ts](https://github.com/withastro/astro/blob/main/packages/astro/src/vite-plugin-astro/hmr.ts)):
   - Vite watches for file changes and triggers `handleHotUpdate`
   - Astro optimizes HMR for specific change types:
     - Style-only changes: Only CSS virtual modules are invalidated
     - CSS dependencies: Invalidates compile metadata when CSS imports change
     - Full changes: Re-compiles the entire component
   - Vite's HMR system propagates updates to the browser

3. **Development Flow**:
   ```
   .astro file changes → Vite detects → vite-plugin-astro compiles →
   @astrojs/compiler transforms → JavaScript output → Vite HMR update → Browser
   ```

### Implications for Puck Config Loading

Since Vite handles all module loading and HMR in Astro's dev mode:

1. **Virtual Modules**: We can use Vite's virtual module system to serve the Puck config
2. **Automatic HMR**: Changes to puck.config.ts will trigger HMR automatically
3. **Component Bundling**: Vite will handle bundling React components in the config
4. **No Custom Build**: We don't need a separate build process for the config

Example virtual module approach:

```typescript
// In the Astro plugin
vite: {
  plugins: [
    {
      name: 'conloca-cms-config',
      resolveId(id) {
        if (id === 'virtual:conloca-cms/puck-config') {
          return '\0virtual:conloca-cms/puck-config';
        }
      },
      load(id) {
        if (id === '\0virtual:conloca-cms/puck-config') {
          return `
          import { puckConfig } from '${userPuckConfigPath}';
          export default puckConfig;
        `;
        }
      },
    },
  ];
}
```

Benefits:

- Leverages existing Vite infrastructure
- HMR works out of the box
- No additional complexity for module loading
- React components are properly bundled
