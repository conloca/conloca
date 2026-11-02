---
name: conloca
description: Load when working on an Astro site using Conloca CMS — @conloca/* packages, .vxjson content, sites.json.
---

# Conloca CMS

Conloca stores pages as `.vxjson` files (visual pages built from Puck components) and `.mdx` files under `content/`, and
renders them through the `@conloca/astro-cms` Astro integration. The visual editor lives at `/__cms` on the dev server
only.

## First move: `conloca doctor`

For any Conloca problem — blank page, 404 on a content page, editor not loading, build failure — run this before reading
source:

```bash
conloca doctor            # human-readable report
conloca doctor --json     # single {ok, problems} object on stdout
```

`conloca <command>` in this skill means `npx @conloca/cli@<version> <command>`: use the exact version a Conloca prompt
gave you, `@latest` when none did. Never run a different version than the prompt names.

It checks the content directory (sites.json complete, site directories present, every content file indexes cleanly) and,
when an astro.config is present, the Astro wiring: content config, conlocaCMS import and options, react() order, peer
dependencies, tsconfig jsx, prerender under server output, Conloca pages hidden behind a `src/pages` file, static pages
with no Conloca pages, and siteStyles. Each problem names the broken file and the fix. It is read-only and exits 1 on
errors; warnings alone exit 0.

New project from an empty directory? `conloca create <dir>` writes and installs the whole wired site. An existing Astro
site: `conloca connect` installs the packages, wires `astro.config` and writes the site's domain for the workspace
editor; `conloca astro setup` only scaffolds the starter files.

## Upgrading Conloca

To move a site to a newer Conloca release:

1. In the site's folder run `npx @conloca/cli@latest upgrade` (or the exact version a Conloca prompt gave you). It
   raises each `@conloca/*` package to the version that CLI release pins in one install, applies the changes between
   versions, refreshes this skill and runs `conloca doctor`. `--dry-run` shows the diffs and changes nothing, `--json`
   prints one object on stdout, `--project <dir>` picks the site folder.
2. Exit `2`: it lists what a person must change first; nothing was touched. Make those changes, then run it again.
3. Exit `1`: it failed and put `package.json`, the lockfile and every changed file back. Fix what it names, run the
   install command its message gives when `node_modules` needs it, and run it again.
4. A `SKILL.new.md` beside a skill means that skill had local edits, so the new text was written next to it: merge it
   into the skill by hand, then delete `SKILL.new.md`.
5. Review `git diff`, run the build, then commit and push yourself — the command never commits or pushes.

Never edit `@conloca/*` versions by hand: each package has its own version, and `upgrade` moves them to the versions one
CLI release pins.

## The files a working site needs

- `astro.config.mjs` — registers `react()` and `conlocaCMS(...)`
- `src/content.config.ts` — declares the content collections (without it every content page 404s)
- `content/sites.json` — sites with their `locales` and `defaultLocale`, plus `globalLocales`
- `src/puck.config.tsx` — registers the Puck components pages are built from
- `src/layouts/Layout.astro` — the page layout content pages render into
- `src/components/puck/*` and `src/schemas/data.ts` — starter components and data-collection schemas

Run `conloca astro setup` inside an existing Astro project. It scaffolds the content config, components, schemas, page
layout, and content directories, preserving existing generated files. It adds the default site to `sites.json` when
missing. It prints the `astro.config` wiring rather than writing that file: merge the printed options into the existing
config, then run `conloca doctor` to verify the result — or run `conloca connect`, which writes the wiring itself.
`conloca init . <site-name>` adds another site to sites.json.

## Install: the exact package set

```bash
npm install @conloca/astro-cms @conloca/content-api @conloca/mdx @puckeditor/core @astrojs/react @vitejs/plugin-react typia
npm install -D ttsc @ttsc/unplugin
```

`@puckeditor/core` is what the generated components import — there is no other Puck package to install.

## Canonical astro.config.mjs

The minimal working config, matching what `conloca astro setup` prints:

```js
import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
import { defineConfig } from 'astro/config';
import { schemaTypia } from './typia-vite.mjs';

export default defineConfig({
  integrations: [
    react(),
    conlocaCMS({
      contentRoot: './content',
      puckConfigPath: './src/puck.config.tsx',
      schemasPath: './src/schemas/data.ts',
      layout: './src/layouts/Layout.astro',
    }),
  ],
  vite: { plugins: [...schemaTypia()] },
});
```

`react()` must come before `conlocaCMS()` — doctor checks the order. `src/schemas/data.ts` declares each data collection
as a TypeScript type plus its generated Typia validator (`typia.plain.createValidatePrune<T>()`) and form metadata
(`typia.json.schema<T>()`); `typia-vite.mjs` is the native transform that generates them, so it must stay in
`vite.plugins`. And `src/content.config.ts`:

```ts
import { conlocaData, conlocaFragments, conlocaPages } from '@conloca/astro-cms/node/content';
import { dataSchemas } from './schemas/data';

export const collections = {
  pages: conlocaPages(),
  ...conlocaData({ dataSchemas }),
  ...conlocaFragments(),
};
```

Every collection is declared here by name — content the config does not name fails the build instead of silently not
building.

## Where errors appear

- `astro dev` runs in the foreground: config and integration errors print to the terminal running it, and page errors
  also show in the browser error overlay. There is no separate log command — read that terminal.
- A page referencing a Puck component type missing from puck.config.tsx serves HTTP 200 with a blank region and a clean
  browser console. The signal is `[Conloca] Page references N component type(s) missing from your Puck config: ...` in
  the dev-server or build terminal.
- `conloca doctor` finds them before a build: C14 warns about every component type or prop a page stores that the Puck
  config does not declare.
- The editor at `/__cms` exists only on the dev server. A production build without it is not a bug.

## Writing content from the command line

Never hand-write files under `content/`, and do not reach for HTTP endpoints: these commands write what the editor
writes, so the result is editable at `/__cms` right away. Each takes `--json` for a machine-readable result.

```bash
conloca page create --site default --collection pages --pathname /about --title 'About us' --content about.json
conloca page update /about --description 'Who we are' --image /media/hero.jpg
conloca data create site --name contact --data contact.json
conloca data update site contact --data - < contact.json
conloca asset add ~/Pictures/hero.jpg --alt 'Fresh bread on the counter'
```

- `page create` — a new page. `--content` takes Puck data `{ root, content, zones }` from a file or `-` (stdin), never
  inline JSON; `--description`, `--image`, `--canonical` and `--robots` fill its page settings.
- `page update` — change an existing page, found by id or pathname; only the flags given change, and an empty value
  (`--robots ''`) clears a field.
- `data create` / `data update` — a shared entry (contact details, a header menu): a JSON object from a file or
  `--data -`. `data update` replaces the entry's whole object: send every field, not just the changed one. Declare the
  collection's type in `src/schemas/data.ts`; the first `data create` wires the data schemas.
- `asset add` — an image into the media folder; it prints the reference an image field stores, e.g. `/media/hero.jpg`.

A layout reads a shared entry by name:

```ts
import { getCollection } from 'astro:content';
import { conlocaDataEntry } from '@conloca/astro-cms/collections';
import { dataSchemas } from '../schemas/data';

const contact = conlocaDataEntry(dataSchemas, 'site', await getCollection('site'), 'contact', 'en');
contact.phone; // typed by the `site` schema
```

A missing name, or one saved in several locales with none given, throws and fails the build instead of rendering empty.

Entries a page's blocks list (team, testimonials) bind to the route with
`routing.routes.<name>.dataBindings.collections`; a block's Puck `resolveData` then reads them from
`metadata.collections.<name>`.

After writing content, run the build: it validates every entry against its schema.

## Routing

- `layout: './src/layouts/Layout.astro'` alone injects a catch-all `/[...slug]` route over the `pages` collection, with
  `prerender: true` and `fallback: '404'`.
- Passing `routing` replaces that default route entirely and the top-level `layout` is then ignored — name it per route
  instead: `routing: { routes: { pages: { pattern: '/[...slug]', layout: './src/layouts/Layout.astro' } } }`.
- `routing: true` is the same default catch-all with no layout.
- `fallback: '404'` returns a bare 404 when no content matches the pattern; `'passthrough'` hands the miss back to Astro
  so the site's own `/404` page renders, with a real 404 status.
- Trap: a `src/pages` file always wins over a Conloca page at the same path, and Astro says nothing. Doctor warns when
  one hides a page; delete the file in the same change that makes the Conloca page live.

## Adding Conloca to an existing Astro site

- Switching to `output: 'server'`: first add `export const prerender = true` to every existing file under `src/pages/`,
  then flip the output — otherwise those pages silently stop being static. Doctor errors on files that miss it.
- Existing `.mdx` content: set the site's `mdxPages` path in `content/sites.json` (relative to the project root, e.g.
  `./src/content/docs`). `.mdx` files under it surface in the CMS as pages of that site; the default locale lives at
  `<mdxPages>/<slug>.mdx`, other locales at `<mdxPages>/<locale>/<slug>.mdx`.
- Plain `.md` files are never adopted — only `.mdx` and `.vxjson` are recognized as pages. Rename `.md` to `.mdx` to
  bring a file under management.

## Converting an existing Astro page

Use this when the user names existing `src/pages` routes to make editable. Convert only those routes.

1. Run `conloca upgrade` (with the version your prompt gave, as defined above). Stop and report if it or
   `conloca doctor` fails: the commands below ship in that release.
2. Run `conloca routes` and check each named route is listed. Dynamic routes (`[slug].astro`, content collection pages)
   and non-default-locale routes are out of scope and never listed.
3. Before changing anything, run `conloca compare --reset --routes /a,/b` with exactly the routes the user named; it
   builds the site and saves a fresh baseline.
4. Run `conloca components --json` to see the components the site already has.
5. Port each section of the page to a React component in `src/components/puck/` whose editable text and images are
   fields. `.astro` components cannot be Puck components: port, do not reuse. Scoped `<style>` moves into a stylesheet
   listed in `siteStyles`; `<script>` and `client:` islands keep working through `withHydration()`; links stay links;
   images that become fields go into the assets folder with `conloca asset add`.
6. Render the page through the layout the original used: point `conlocaCMS` (or a per-route layout) at it and adapt it
   to the props Conloca passes (`title`, `description`, `page`).
7. Text from data files (like `src/data/*.ts`): per-page text goes into the page; values shared across pages go into
   data entries, moved once, on the first conversion that needs them. Every importer of those values (pages, layout,
   endpoints, browser components through props) then reads the same data entries, so there is one copy. Pages the user
   did not name may change only there, and their output must stay identical.
8. The shared header and footer stay code in the layout. Their texts and links (menu items, footer links, contact
   details) move into a data entry the layout reads. Fragments are for prose blocks placed inside pages.
9. Read a shared entry by a fixed name and fail the build when it is missing or duplicated:
   `conlocaDataEntry(dataSchemas, 'site', await getCollection('site'), 'header', 'en').menu` throws in both cases.
10. Write all content through the CLI: `conloca page create` / `conloca page update` (with `--content` and the metadata
    flags), `conloca data create` / `conloca data update`, `conloca asset add`. Never hand-write content files.
11. Delete the old `.astro` file in the same change that makes the Conloca page live. A `src/pages` file always wins
    over a Conloca page at the same path, so the page cannot be seen before that; `conloca compare` is the check, not
    the browser.
12. Run `conloca compare` again. Every route you did not convert must be identical (its linked stylesheets too); every
    converted route must keep its text, links, `<head>` tags and status; a route that became a Conloca page without
    being named fails. Fix and rerun until it passes, then run `conloca doctor`.
13. Report every changed file, every page you were not asked to convert whose code changed, every allowed change
    `conloca compare` listed (for example island props that now carry shared values), and anything that could not be
    converted faithfully.

The workspace also has an MCP server for editing content remotely: pages, fragments and data entries on pushed branches.
It cannot change code, upload media or publish. Use the address the editor's prompt gives you; never guess or hardcode
one. Setup and limits: https://conloca.com/workspace-mcp/.

## Custom Puck components

Follow the generated examples in `src/components/puck/` — that is the one proven path:

1. Write a render component plus a `ComponentConfig` wrapped in `withLayout` from `src/components/ComponentLayout.tsx`,
   mirroring the generated `HeadingComponent.tsx` / `Heading.tsx` pair.
2. Register the component and its Props type in `src/puck.config.tsx`: add it to the `Components` type and the
   `components` map (and optionally a `categories` entry).
3. Types come from `@puckeditor/core`. If `.tsx` components misrender or fail typecheck, set tsconfig
   `"jsx": "react-jsx"` — doctor's advisory warning covers this.

A component referenced by stored content but not registered renders blank — see "Where errors appear".

## Known limits — by design, do not fight them

- MDX fragments render prose only.
  `Unknown component <X>: fragments render as plain content and cannot use React components.` is intentional: fragment
  content is treated as untrusted, so `{...}` expressions and `import`/`export` statements are rejected too. Do not try
  to sneak components in.
- Unknown Puck component types render as nothing; the dev-server or build console names them. The fix is registering the
  type in `puck.config.tsx`, not editing the stored content.
