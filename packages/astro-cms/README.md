# @conloca/astro-cms

A developer-focused CMS for Astro that runs exclusively in development mode. This CMS provides a visual interface for
managing content using Puck's drag-and-drop editor, allowing developers to create and edit pages visually while
maintaining full control over their content structure. The CMS integrates seamlessly into your Astro development
workflow, accessible at `/__cms` routes without requiring authentication or complex setup.

## Getting started

### Install

```bash
npm install @conloca/astro-cms
npm install @astrojs/react @vitejs/plugin-react astro react react-dom vite zod
```

The second line is the full peer set — the CMS expects the host site to own those packages. `@astrojs/react` is not
optional: the editor is a React application, and this integration does not register Astro's React renderer for you. A
site that omits it serves the editor route with no editor in it.

### The four files a site needs

A working site needs all four of these. Omitting any one of them breaks the site or the editor, in most cases without an
error message.

#### 1. `astro.config.mjs`

`react()` must be listed before `conlocaCMS()`.

```js
import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [
    react(),
    conlocaCMS({
      contentRoot: './content',
      puckConfigPath: './src/puck.config.tsx',
      layout: './src/layouts/Layout.astro',
    }),
  ],
});
```

Import the integration from `@conloca/astro-cms/node`, not from the package root. The root export deliberately throws
with a message pointing at the `/node` subpath: the root entry stays free of Node-only code so it can load in any
runtime, including the browser.

`puckConfigPath` points at a module whose default export is a Puck `Config` — the components it lists become the
editor's palette, and the folders they live in are what the integration scans for hydratable components.

```tsx
// src/puck.config.tsx
import type { Config } from '@puckeditor/core';
import { Text } from './components/puck/Text';

const puckConfig: Config = {
  components: {
    Text,
  },
};

export default puckConfig;
```

These must be React components. An `.astro` component cannot be listed here — Astro compiles those into a server-side
renderer with its own hydration model, so they cannot be wrapped as React components for the editor to render.

#### 2. `src/content.config.ts`

**Without this file every content page returns 404.** The integration registers the routes, but Astro only has content
to render once the collections are defined, and defining them is this file's whole job.

```ts
import { conlocaData, conlocaFragments, conlocaPages } from '@conloca/astro-cms/node/content';
import { dataSchemas, pageSchemas } from './schemas';

export const collections = {
  pages: conlocaPages({ pageSchemas }),
  ...conlocaData({ dataSchemas }),
  ...conlocaFragments('general'),
};
```

The keys are the collection names, and `dataSchemas`' own keys become the data collections — nothing is named twice. A
site with no custom page fields writes `conlocaPages()` on its own, and a site with no data collections drops the
`conlocaData` line; `conlocaFragments()` with no names still defines the aggregate the renderer reads. No paths are
passed: the integration publishes its `contentRoot` option through the environment before the content config loads, so
the one path in `astro.config.mjs` covers both.

Entries come back typed — `getCollection('pages')` carries `pathname`, `title`, the dates and, via the `HostPageMeta`
augmentation, the host's own page fields, and a data entry carries `data` typed by its schema. That `data` is optional
(`data?: T`): an entry saved before any payload exists is not an error, so readers guard the access. Content the config
does not declare fails the build, and the error names the collection and its kind, rather than silently not building;
declaring a collection before its folder exists is the normal order, since the folder appears with the first entry saved
in the editor. The editor saves new fragments in the `fragments` folder, and every form of `conlocaFragments(...)`
declares that folder, so it never needs naming for the build to accept it.

A site with no MDX fragments yet prints this once per rendered page, and it is expected — nothing is wrong with the file
this message points at:

```plain
The collection "__conloca_fragments" does not exist or is empty. Please check your content config file for errors.
```

Astro prints it from `getCollection()` whenever a collection holds no entries, and there is no way to register an empty
one — leaving the collection out produces the very same message. It stops as soon as the site has one published
fragment.

#### 3. `content/sites.json`

Lives at the root of `contentRoot` and declares the sites and their locales. A single-site setup names its site
`default`, which is the site name every other default assumes.

```json
{
  "sites": {
    "default": {
      "locales": ["en"],
      "defaultLocale": "en"
    }
  },
  "globalLocales": ["en"]
}
```

If the file is missing the CMS logs a warning and falls back to an empty site list, which means no page collections get
created — the same symptom as a missing content config.

#### 4. The layout named by `layout`

An ordinary Astro layout. It receives `title` and `description`, and renders the page body through `<slot />`. It also
receives `page`, the page being rendered with its settings in `page.meta`; read extra head fields such as an Open Graph
image from there rather than querying the collection again.

```astro
---
interface Props {
  title?: string;
  description?: string;
}

const { title, description } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{title ?? 'My site'}</title>
    {description && <meta name="description" content={description} />}
  </head>
  <body>
    <slot />
  </body>
</html>
```

Supplying `layout` and nothing else turns on a catch-all `/[...slug]` route over the `pages` collection with a `404`
fallback. Sites that need more than one route drop `layout` and use `routing.routes.<name>.layout` instead.

With those four files in place, run the Astro dev server and open `/__cms`.

### Options

Passed to `conlocaCMS({ ... })`. Only two are required.

| Option                 | Required | What it does                                                                                                                                        |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentRoot`          | yes      | Directory holding `sites.json` and the content files. Also handed to the collection factories, so the content config needs no copy of it.           |
| `puckConfigPath`       | yes      | Module whose default export is the Puck `Config`. Supplies the visual editor's component palette and seeds component auto-discovery.                |
| `canvasDir`            | no       | Directory for canvas documents.                                                                                                                     |
| `route`                | no       | Where the CMS mounts. Defaults to `/__cms`.                                                                                                         |
| `layout`               | no       | Default layout for content pages. On its own it enables routing with a catch-all pattern.                                                           |
| `routing`              | no       | Full routing configuration, for sites with more than one content route.                                                                             |
| `templates`            | no       | Page templates offered in the create-page dialog.                                                                                                   |
| `schemasPath`          | no       | Module exporting `dataSchemas`, `pageSchemas` and `mdxComponents`. Drives the page-settings form and the MDX component registry.                    |
| `contentSchemasPath`   | no       | Schema-only module exporting the `pageSchemas` / `dataSchemas` your content config passes to `conlocaPages()` / `conlocaData()`. Draft previews parse entries with the collection schemas built from it, as the build does. |
| `componentPaths`       | no       | Extra folders to scan for components wrapped in `withHydration()`.                                                                                  |
| `mdxComponentFolders`  | no       | Folders scanned for locally authored MDX components, whose `interface Props` becomes the editor's prop panel. Defaults to `['src/components/mdx']`. |
| `assetsPath`           | no       | Upload directory; enables the Media Library. The site must serve it from `publicDir`, directly or through a link there, or dev and build fail.      |
| `siteStyles`           | no       | CSS injected into the Puck preview iframe so components render with site styling.                                                                   |
| `editorStyles`         | no       | CSS injected into the MDX editor's admin document. Host-component selectors only — see the file's own notes on what does not belong.                |
| `editorCSS`            | no       | Raw CSS applied after auto-discovered host styles in the editor's host-preview layer.                                                               |
| `fragmentPreviewRoute` | no       | Route whose styles and content wrapper frame the standalone fragment editor. Defaults to `/`.                                                       |
| `locales`              | no       | The site's locales and default locale. Without it: the site's `locales` and `defaultLocale` in `sites.json`, else `globalLocales`.                  |

`ConlocaCMSOptions` also extends the editor's `UIConfig` (minus `basename`), so fields such as `apiBaseUrl`,
`siteBaseUrl`, `enableDevtools`, `queryClientOptions`, `projectRoot` and `hosted` are accepted as well. Those exist for
hosts that embed the editor in their own shell; an ordinary Astro site leaves them alone.

**`puckConfigPath` and `schemasPath` are unrelated options.** They resolve different files, feed different parts of the
CMS, and neither falls back to the other. `puckConfigPath` is required and supplies the visual page editor's component
palette. `schemasPath` is optional and supplies frontmatter forms plus the MDX component registry described below.
Setting `schemasPath` does not make `puckConfigPath` unnecessary, and a site with no `schemasPath` still works — it just
has no custom page-settings fields and no registered MDX components.

### Sitemap for on-demand pages

A static build writes a file for every published page, and `@astrojs/sitemap` lists those by itself. A route with
`prerender: false` renders its pages on demand instead, so there is no file to find and the sitemap leaves them out.
`conlocaSitemapOptions` returns the two `@astrojs/sitemap` options the CMS's pages need: `customPages`, the full address
of every published page the CMS routes serve, and `serialize`, which gives each of them its last-edit date as
`<lastmod>`. Addresses follow your `site`, `base`, `trailingSlash` and `build.format`, so hand it the same settings you
give Astro, along with the same options as `conlocaCMS()`:

```js
import node from '@astrojs/node';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import { conlocaCMS, conlocaSitemapOptions } from '@conloca/astro-cms/node';
import { defineConfig } from 'astro/config';

// Every setting that decides a page's address, shared by Astro and the sitemap.
const urls = { site: 'https://example.com', trailingSlash: 'always' };
const cmsOptions = {
  contentRoot: './content',
  puckConfigPath: './src/puck.config.tsx',
  routing: {
    routes: {
      pages: { pattern: '/[...slug]', layout: './src/layouts/Layout.astro', prerender: false },
    },
  },
};

export default defineConfig({
  ...urls,
  adapter: node({ mode: 'standalone' }),
  integrations: [react(), sitemap(await conlocaSitemapOptions(cmsOptions, urls)), conlocaCMS(cmsOptions)],
});
```

The list is read when the config loads, so publish and unpublish dates count as of the build. If a CMS route is
prerendered after all, its pages get the address Astro gives them, so each appears once, not twice. Pages are listed in
the language the CMS routes serve (`routing.locale`), because the routes give other languages no address. A page whose
last-edit date cannot be read is listed without `<lastmod>` instead of failing the build. To pass sitemap options of
your own as well, put them in one object with these, as in
`sitemap({ ...(await conlocaSitemapOptions(cmsOptions, urls)), changefreq: 'weekly' })`. A `serialize` of your own
replaces this one, so call this one inside it.

### Listing CMS pages on an Astro page

A block on a CMS page gets its list of pages from the route's `dataBindings.pages`. An ordinary Astro page, such as a
blog index or an RSS route, asks for the same list through `@conloca/astro-cms/page-feed`:

```astro
---
import { getPagesByPrefix } from '@conloca/astro-cms/page-feed';

const posts = await getPagesByPrefix('/blog/');
---

<ul>
  {posts.map((post) => <li><a href={post.pathname}>{post.title}</a></li>)}
</ul>
```

The list holds the published pages under the prefix, in the site's language, without the page at the prefix itself. Each
entry is a `PageReference`: `meta` carries the page's own fields, including the ones `pageSchemas` declares, and
`timestamps` carries created, modified and published dates. `published` is the page's publish time or, when it has none,
its creation time. The second argument takes `sort` (`'date-desc'`, the default, puts the newest publish date first, so
editing a page never moves it; `'date-asc'` and `'title'` are the others; pages that tie are listed by path), `limit`,
and `locale` to read another language. It reads the pages of the content routes `conlocaCMS()` serves, so it needs
`layout` or `routing` set there and throws when neither is.

## MDX component registry

Hosts can register JSX components (their own, or third-party ones like Starlight's `<Steps>`, `<Tabs>`, `<Card>`) with
the MDX editor so authors get typed insert affordances and optional auto-import injection. The registry is wired through
the same `schemasPath` option that already loads `pageSchemas` — add an `mdxComponents` export to the file and the CMS
picks it up at boot (and on HMR).

```ts
// src/schemas.ts
import { defineMdxComponents } from '@conloca/astro-cms';

export const pageSchemas = {/* existing entries */};

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
JSX node. This is a hard constraint of the underlying `@mdxeditor/editor` export pipeline (see
`dist/exportMarkdownFromLexical.js` in that package), not a policy choice.

For Starlight-flavored docs (where MDX only imports Starlight components from `@astrojs/starlight/components`) the
behavior matches authorial intent — imports follow usage. For richer MDX that relies on type or side-effect imports,
edit those files in your IDE rather than the CMS, or omit `import.from` from your descriptors so the editor does not
claim ownership of the import line.
