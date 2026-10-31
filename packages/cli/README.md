# @conloca/cli

Command-line interface for Conloca content management.

## Installation

```bash
npm install -g @conloca/cli
# or
bun add -g @conloca/cli
```

## Usage

`conloca --version` prints the CLI's release, the one `upgrade` brings a site to.

### Create a Project

Create a new Astro site with Conloca CMS wired in, from an empty directory:

```bash
conloca create <directory> [--site <site>] [--pm <manager>] [--no-install] [--no-git] [--json]
```

This writes a complete project — `package.json`, `astro.config.mjs` with `conlocaCMS()` wired, `tsconfig.json`,
`src/content.config.ts`, the starter components and Puck config, a first page at `/`, the agent skill, and a GitHub
Actions workflow that runs the doctor and the build and builds a pull request's own commit. Then it installs
dependencies, runs `git init`, and runs `conloca doctor` on the result. It refuses a non-empty directory; for an
existing site use `conloca connect`.

`--site` defaults to `default`. `--pm` takes `bun`, `npm`, `pnpm` or `yarn` and defaults to the package manager that
launched the CLI — `bunx` selects bun, `npx` npm, `pnpm dlx` pnpm — falling back to `npm`. Installing and `git init` are
on unless you pass `--no-install` or `--no-git`, and the command never prompts.

`--json` prints one object: `{ok, directory, packageManager, created, install, git, doctor: {ok, problems}}`.

### Connect a site

Set up an existing Astro site's editor page, so your workspace editor at `<slug>.conloca.com` can edit it:

```bash
conloca connect [path] [--project <dir>] [--site-url <url>] [--yes] [--dry-run] [--no-install] [--no-build] [--json]
```

An agent can do it in one line:
`In my Astro site's folder, run npx @conloca/cli@<version> connect, then commit, push and deploy.`

Run it in the site's folder or the repository holding it. In order, it:

1. **Finds the project:** the Astro project in `[path]`. A repository with several asks which one in a terminal; without
   one it lists them and stops, so you pass `--project <dir>`. The editor needs the repository on GitHub; without a
   GitHub `origin` it continues and says so. A site whose `@conloca/*` packages are older than this CLI is handed to
   `upgrade`: `connect` prints the `upgrade` and `connect` commands to run, writes nothing and exits `2`.
2. **Adds packages:** `@conloca/astro-cms`, `@conloca/cloud-astro`, `@astrojs/react` and `@vitejs/plugin-react`,
   whichever `package.json` lacks, with the package manager of the nearest lockfile. `--no-install` prints the command
   instead.
3. **Wires `astro.config`:** `react()`, then `conlocaCMS()`, then `conlocaCloud({ repoUri })`, with their imports. A
   site without `conlocaCMS()` also gets the `conloca astro setup` starter files and a `src/content.config.ts`. A config
   that is not a plain `defineConfig({ integrations: [...] })` is left alone: `connect` prints the lines to add. It
   never adds an adapter or `output`.
4. **Writes the address:** the host of Astro's `site` (or `--site-url`) into `sites.json` under the site's default
   locale, and Astro's `base` when it is not `/`. It never writes Astro's `site` itself.
5. **Allows framing:** only where a committed header file (`public/_headers`, `netlify.toml`, `vercel.json`) forbids
   framing today, it adds a rule for `/_conloca/editor/`. A site-wide `frame-ancestors` policy is left to you.
6. **Builds once:** runs the project's `build` script and checks that the output holds `_conloca/editor/index.html` and
   a `conloca.json` with the site's id. `--no-build` skips it.
7. **Removes the old build key:** workflow lines that still pass `CONLOCA_BUILD_TOKEN`, which the editor page does not
   need.

Every change is printed as a diff first. In a terminal `connect` asks once; `--yes` accepts without asking; `--dry-run`,
or no terminal and no `--yes`, writes nothing. A value you set yourself (another domain, your own `conlocaCloud()`
options, your own `/_conloca/editor/` header rule) is kept and reported as `differs`; only an explicit answer in a
terminal replaces it, never `--yes`. A second run on a connected site changes nothing.

`connect` never commits, pushes or deploys, and the package install is its only network use. Next steps: commit, push to
the default branch, deploy as usual, then open your workspace editor at `<slug>.conloca.com`.

Exit codes: `0` every step is done, changed, skipped or kept; `1` a step failed; `2` a step needs you. `--json` prints
one object: `{ok, project, siteId, packageManager, steps: [{id, state, files?, message}], next}`, where `state` is
`done`, `changed`, `needs-you`, `differs`, `failed` or `skipped`.

### Upgrade a site

Bring every `@conloca/*` package of a site to the release of the CLI you run, with the changes that release needs:

```bash
npx @conloca/cli@latest upgrade [path] [--project <dir>] [--dry-run] [--json]
```

Run it in the site's folder or the repository holding it; it picks the Astro project the way `connect` does. In order,
it:

1. **Refuses what it cannot raise safely:** a `@conloca/*` spec that is no version range (`catalog:`, `workspace:`,
   `link:`, `file:`), `overrides` or `resolutions` pinning a `@conloca/*` package, and any `@conloca/*` package newer
   than this CLI, which it never moves back (it names the release to run instead). A site with no `@conloca/*` package
   is sent to `connect`.
2. **Dry-runs every migration** between the site's oldest `@conloca/*` release and this one, and stops before touching
   anything when one fails or needs you.
3. **Writes:** saves `package.json` and the lockfile, raises every `@conloca/*` package in one package manager install
   (each stays in its own section, `devDependencies` included, also in a workspace root's `package.json`), applies the
   migrations and refreshes the agent skills. A skill page you edited is never overwritten: the new text goes to
   `SKILL.new.md` beside it.
4. **Checks:** every installed `@conloca/*` package has the same version, then runs `doctor`.

The package and migration changes are printed as a diff first; `--dry-run` stops there. The agent skill refresh is not
previewed: it reads the `@conloca/cloud-astro` the install brings, and only reports which pages it wrote. On any failure
the saved files are put back and the report says so, with the install command that puts `node_modules` back. A second
run on an upgraded site changes nothing. `upgrade` never commits or pushes.

Exit codes: `0` every step is done, changed or kept; `1` a step failed and the site was restored; `2` a step needs you
and nothing was touched. `--json` prints one object:
`{ok, project, from, to, packageManager, restored, unrestored, steps: [{id, state, files?, message}]}`.

### Initialize Content Structure

`conloca create` and `conloca astro setup` already do this for the first site — use `init` to add another one.

Initialize a new Conloca content structure for a site:

```bash
conloca init <directory> <site>
```

This command will:

- Create the content directory structure
- Create directories for the specified site
- Create or update the sites.json configuration file
- Set up the fragments/shared directory for shared components

Example:

```bash
conloca init . default
```

### Astro Integration

Set up Astro integration with Puck components and configuration:

```bash
conloca astro setup [path]
```

This command will generate:

- `src/puck.config.tsx` - Puck component configuration
- `src/components/ComponentLayout.tsx` - Puck HOC adding grid/flex props to a component
- `src/components/Section.tsx` - Section wrapper component
- `src/components/puck/Heading.tsx` - Heading component
- `src/components/puck/Text.tsx` - Text component
- `src/components/puck/Flex.tsx` - Flex layout component
- `src/components/puck/Grid.tsx` - Grid layout component
- `src/layouts/Layout.astro` - Bare page layout, meant to be replaced
- `src/schemas/data.ts` - Example Typia data-collection schemas (types plus generated validators and form metadata)
- `typia-vite.mjs` / `tsconfig.typia.json` - The native Typia transform `astro.config.mjs` runs over `src/schemas/`
- `content/sites.json` - Site list, holding the site `default`
- `.claude/skills/conloca/SKILL.md` - One-page Conloca guide for coding agents

Existing files are left alone, so the command is safe to re-run.

> **Note:** Routes are handled by the Astro plugin. Naming the page layout with
> `conlocaCMS({ layout: './src/layouts/Layout.astro' })` turns on a catch-all `/[...slug]` route over the `pages`
> collection. Passing `routing` as well replaces that route and the top-level `layout` is then ignored, so multi-route
> sites name their layout under `routing.routes.<name>.layout` instead.

Examples:

```bash
# Set up in current directory
conloca astro setup

# Set up in a specific project
conloca astro setup ./my-astro-project
```

### Check Project Health

Run read-only health checks over a project (replaces the removed `verify` command):

```bash
conloca doctor [path] [--json] [--live]
```

| Argument / Option | Description                                                       | Default                 |
| ----------------- | ----------------------------------------------------------------- | ----------------------- |
| `path`            | Project directory to check                                        | `.` (current directory) |
| `--json`          | Report as a single JSON object on stdout                          |                         |
| `--live`          | Let doctor extensions contact the services the project configures |                         |

Content checks, always:

- `sites.json` exists, parses, and declares `defaultLocale` plus a non-empty `locales` list for every site, each locale
  one a content file name can carry: a two-letter language code, optionally with a region, like `en` or `en-US`
- every configured site has its `pages/` directory on disk (site-shaped directories missing from `sites.json` are
  flagged too)
- every content file indexes cleanly — each file reported is one the CMS would otherwise silently drop

Astro checks, when an `astro.config` (`.mjs`, `.js`, `.ts`, `.mts` or `.cjs`) is present (the config is read as text,
never executed):

- the content config registers Conloca's collections
- `conlocaCMS` is imported from `@conloca/astro-cms/node` and its options carry `contentRoot`, `puckConfigPath`, and a
  `routing` block or `layout`
- `react()` is in `integrations` and comes before `conlocaCMS()`
- the `@vitejs/plugin-react` peer is declared in `package.json`
- `tsconfig.json` sets `compilerOptions.jsx` to `react-jsx` (advisory — a warning only)
- with `output: 'server'`, every file under `src/pages` declares `prerender`
- no Conloca page is hidden behind a `src/pages` file at the same path — the file always wins (a warning)
- a site with static `src/pages` routes has at least one Conloca page for the editor (a warning)
- every component and prop a Puck page stores is one the Puck config declares — an undeclared one renders as nothing (a
  warning)
- when Conloca pages exist and `src/` holds a stylesheet, `siteStyles` brings it into the editor (a warning)

Anything doctor cannot determine becomes an explicit warning, never a silent pass, and it never modifies files. The exit
code is 1 when any error is found; warnings alone exit 0. `--json` prints a single `{ok, problems}` object, each problem
carrying `check`, `level`, `message`, and usually `path`. Pointing doctor at a directory already named `content` uses
that directory as the content root, unless it holds a `content/` directory of its own.

Example:

```bash
conloca doctor ./my-astro-project
```

```plain
Checking /path/to/my-astro-project/content
✓ C3 sites.json is present and complete
✓ C4 site directories match sites.json
✗ C12 content files index cleanly (3 files)
    error: Could not parse VXJSON header for default/pages/broken.en.vxjson (malformed-vxjson)
✓ C1 content config registers Conloca collections
…
✓ C11 no Conloca page is hidden behind a src/pages file
✓ C13 the site has Conloca pages to edit
✓ C14 pages use only components and fields the Puck config declares
✓ C15 siteStyles styles Conloca pages in the editor

Found 1 error, 0 warnings
```

### Doctor extensions

Doctor also runs checks shipped by the project's own dependencies. Any package in `dependencies` or `devDependencies`
whose `package.json` carries a `conloca.doctor` field is a doctor extension; the field names a module relative to that
package, e.g. `"conloca": { "doctor": "./dist/doctor.mjs" }`. Resolution starts at the project, never at the CLI's own
install, so a globally installed CLI still finds the project's packages.

The entry is an ES module whose default export is called once with
`{ contractVersion: 1, projectDir, contentRoot, live }` (a CommonJS module that exports the function as `module.exports`
works too) and returns `{ contractVersion: 1, checks }`, where every entry of `checks` has the same shape as doctor's
own: `{ id, label, problems: [{ check, level: 'error' | 'warn', message, path? }], detail?, skipped? }`. The checks are
appended to the report and to `--json` exactly like built-in ones, so an extension error fails doctor.

Extensions must stay read-only, and offline unless `live` is true. `live` is true only under `conloca doctor --live`;
without it an extension should mark its network checks as skipped. A contract-version mismatch, a package that fails to
load, or a malformed result becomes one warning naming the package — never a crash and never a silent skip. Those
seam-level warnings carry the check id `EXT`, so `--json` consumers can tell them from an extension's own findings.

### List routes

List a site's static routes and which of them are Conloca pages:

```bash
conloca routes [path] [--site <site>] [--json]
```

| Argument / Option | Description                               | Default                 |
| ----------------- | ----------------------------------------- | ----------------------- |
| `path`            | Project directory, holding `astro.config` | `.` (current directory) |
| `--site`          | Site in `sites.json` to list              | the first site          |
| `--json`          | Report as a single JSON object on stdout  |                         |

It lists every static page route of `src/pages` and every default-locale Conloca page of the site, one line per route.
When a `src/pages` file and a Conloca page serve the same path, the file wins and the page is marked hidden. Dynamic
routes (`[slug].astro`, content collection pages) and non-default-locale routes are never listed. Read-only: it never
modifies a file. `--json` prints `{ok, site, routes}`; each route carries `route`, plus `file` and `prerendered` for a
`src/pages` file, `pageId` for a Conloca page, and `hidden: true` when both serve it.

```plain
/  src/pages/index.astro
/about  Conloca page about
/pricing  src/pages/pricing.astro
  src/pages/pricing.astro hides Conloca page pricing
```

### Compare builds

Build the site and compare its output before and after converting pages:

```bash
conloca compare [path] [--routes <routes>] [--reset] [--json]
```

| Argument / Option | Description                                                  | Default                 |
| ----------------- | ------------------------------------------------------------ | ----------------------- |
| `path`            | Project directory, holding `astro.config`                    | `.` (current directory) |
| `--routes`        | Comma-separated routes the user chose to convert (first run) | none                    |
| `--reset`         | Remove the saved baseline first, so this run saves a new one |                         |
| `--json`          | Report as a single JSON object on stdout                     |                         |

The first run builds the site with its package manager's `run build` and saves the output as a baseline in
`node_modules/.cache/conloca-compare`, with the routes the user chose to convert (`--routes /pricing,/about`). Later
runs build again and compare every route with the baseline:

- A route nobody touched must be identical, linked `/_astro/*.css` content included. Hashed asset names, timestamps and
  island ids never count; island props that changed because shared values moved into data entries are reported as
  allowed. Sitemaps compare as a set of locations.
- A chosen route that became a Conloca page must keep its text (with image alt texts), links, head tags and status (page
  or redirect); its markup may change.
- A route that became a Conloca page without being chosen fails, and so does a Conloca page still hidden behind its
  `src/pages` file, unless it was already hidden at baseline and not chosen.

It reads the build from `dist/client` when `dist/server` exists too (a server adapter), else `dist`, and fails when the
build wrote no fresh HTML there. The site is the first one in `sites.json`. The baseline stays until `--reset`;
`--routes` is accepted only on the run that saves it. Never commits. Exits 1 when anything differs. `--json` prints
`{ok, baseline, chosenRoutes, routes, missing, added, unchosen, hidden}`; each route carries `route`, `kind`
(`untouched` or `converted`), `differences` and `allowed`.

### List components

List the site's Puck components and the fields each accepts:

```bash
conloca components [path] [--json]
```

| Argument / Option | Description                                    | Default                 |
| ----------------- | ---------------------------------------------- | ----------------------- |
| `path`            | Project directory, holding `astro.config`      | `.` (current directory) |
| `--json`          | Print the component manifest as JSON on stdout |                         |

It reads the Puck config that `conlocaCMS`'s `puckConfigPath` names from source, without running it, and prints one line
per component with its fields, then each component it could not read with the reason. `--json` prints the manifest the
editor and agents use: `components`, `unresolved` and, when the config cannot be fully read, `unreadable: true` with
`unreadableReason`. An unreadable config is still an answer; the command fails only without an `astro.config` or when
`puckConfigPath` is not a plain string. Read-only: it never modifies a file.

```plain
Hero: title (text), image (image)
Card: heading (text), body (textarea)
```

### Create a Page

Create a Puck page in a site's default locale:

```bash
conloca page create --site <site> --collection <collection> --pathname <pathname> --title <title> [path] [--content <file|->] [--description <text>] [--image <ref>] [--canonical <url>] [--robots <value>] [--json]
```

| Argument / Option           | Description                                                                 | Default                 |
| --------------------------- | --------------------------------------------------------------------------- | ----------------------- |
| `path`                      | Project directory holding the content root                                  | `.` (current directory) |
| `--site <site>`             | Site the page belongs to (a key in `sites.json`)                            |                         |
| `--collection <collection>` | Collection directory under the site, e.g. `pages`                           |                         |
| `--pathname <pathname>`     | Page route, must start with `/`                                             |                         |
| `--title <title>`           | Page title (`meta.title`)                                                   |                         |
| `--content <file\|->`       | Puck data `{ root, content, zones }` from a JSON file, or `-` to read stdin | the empty page          |
| `--description <text>`      | Page description (`meta.description`)                                       |                         |
| `--image <ref>`             | Social sharing image (`meta.ogImage`)                                       |                         |
| `--canonical <url>`         | Canonical URL (`meta.canonical`)                                            |                         |
| `--robots <value>`          | Robots directive, e.g. `noindex` (`meta.robots`)                            |                         |
| `--json`                    | Report as a single JSON object on stdout                                    |                         |

Writes a new `.vxjson` file under `<content root>/<site>/<collection>` holding the Puck data `--content` points at, or
the same empty Puck payload the CMS writes for a new page, then prints the page id and the created file path. The
metadata flags are the fields of the editor's page settings. Inline JSON is not accepted: pass a file, or pipe the JSON
into `--content -`. It exits 1 when the site is unknown, the pathname is invalid or already taken, `--content` is not
Puck data, or the write fails; validation failures name the offending option. `--json` prints
`{ok, id, path, warnings?}` on success and `{ok: false, error, field?}` on failure — stdout carries exactly that one
object, progress lines and warnings go to stderr.

A collection other than `pages` must be declared with `conlocaPages({ collection })` in the content config, or the build
fails on its pages, and given a route in `conlocaCMS({ routing })` to be served; `page create` warns when the config
plainly does not declare it.

Example:

```bash
conloca page create --site default --collection pages --pathname /about --title 'About us'
```

```plain
Indexing 1 content files...
✓ Created page /about (vx-0o0swYcO)
  File: content/default/pages/about.en.vxjson
The page is now editable in the CMS.
```

### Update a Page

Change the content or metadata of an existing page in a site's default locale:

```bash
conloca page update <id|pathname> [path] [--site <site>] [--title <title>] [--content <file|->] [--description <text>] [--image <ref>] [--canonical <url>] [--robots <value>] [--json]
```

The page is found by its id, or by its route when the reference starts with `/` (`/about/` finds `/about`). `--site`
defaults to `default`; the other options mean what they mean for `page create`. Only what is given is written:
`--content` replaces the Puck data and keeps the metadata, a metadata flag sets its field and keeps the content, and an
empty value (`--robots ''`) clears the field. `--content` writes Puck pages only, so an MDX page takes metadata flags
alone. It exits 1 when no page has that id or route, the id belongs to a data entry or fragment, nothing is given to
update, or the write fails. `--json` prints `{ok, id, path}` on success and `{ok: false, error, field?}` on failure.

Example:

```bash
conloca page update /about --content about.json --description 'Who we are'
```

### Data entries

Create a data entry, such as site settings or an author, in a site's default locale:

```bash
conloca data create <collection> [path] --name <name> --data <file|-> [--title <title>] [--site <site>] [--no-install] [--json]
```

`--data` is a JSON object, read from a file or from stdin with `-`; anything else is refused before a file is written.
The entry lands in `<content root>/data/<collection>/<name>.<locale>.json`, titled `--title` or its name. A name another
entry of the collection has, in any letter case, is refused. A site without data schemas yet is wired first:
`schemasPath`, `assetsPath` and the Typia vite plugin in `astro.config`, `conlocaData()` in the content config, the
starter `src/schemas/data.ts`, `typia-vite.mjs` and `tsconfig.typia.json`, and the Typia packages, added with the site's
package manager (`--no-install` prints that command instead). A config it cannot edit stops the command, with the lines
to add by hand. When the schemas module declares no such collection, it warns that the build fails on the entry.
`--json` prints `{ok, id, path, wired?, command?, warnings?}`.

Replace the data of an existing entry, found by its id or by its name in the collection:

```bash
conloca data update <collection> <id|name> [path] --data <file|-> [--title <title>] [--site <site>] [--json]
```

It keeps the title unless `--title` is given, and exits 1 when no entry of the collection has that id or name. `--json`
prints `{ok, id, path}`.

Example:

```bash
echo '{"siteName":"Corner Bakery"}' | conloca data create settings --name site --data -
```

### Add an image

Copy an image into the site's media folder and print the reference an image field stores:

```bash
conloca asset add <file> [path] [--folder <folder>] [--alt <text>] [--no-install] [--json]
```

The image lands in the `assetsPath` of `conlocaCMS()`, stored the way an editor upload stores it: the name lowercased
and made URL-safe, keeping underscores and inner dots (`Hero Shot.JPG` becomes `hero-shot.jpg`, `My_Photo.JPG` becomes
`my_photo.jpg`), a name already taken in any letter case stored as `hero-1.jpg`, and only web image formats up to 25 MB
taken. A photo whose long edge is over 2560 pixels is stored as a 2560 pixel WebP named `.webp` (a PNG stays PNG),
upright and without its location data; without the optional `sharp` package it is stored unshrunk with a warning.
`--folder` puts it in a folder inside the media folder (a new folder must be a name Git and an image link can hold: no
spaces, no leading dot, none of `# ? % & * : |`); `--alt` records its alt text. A site without data schemas is wired
first, as `data create` wires it: the schemas, the assets folder and the Typia packages. It prints the reference, such
as `/media/hero.jpg` (with the site's `base` in front), and the file path; `--json` prints
`{ok, ref, path, wired?, command?}`. A config that computes `assetsPath`, `publicDir` or `base` stops the command.

Example:

```bash
conloca asset add ~/Pictures/hero.jpg --alt 'Fresh bread on the counter'
```

## Quick Start

```bash
bunx @conloca/cli create my-site
cd my-site
bun run dev
# open http://localhost:4321/__cms
```

Adding Conloca to an existing Astro site instead? Install the packages, run `conloca astro setup`, add the options it
prints to `astro.config.mjs`, create `src/content.config.ts` as printed, then run `conloca doctor`:

```bash
npm install @conloca/astro-cms @conloca/content-api @conloca/mdx @puckeditor/core @astrojs/react @vitejs/plugin-react typia
npm install -D ttsc @ttsc/unplugin
conloca astro setup
conloca doctor
```

## Development

### Building

```bash
bun run build
```

### Testing

```bash
bun test
```

The CLI is bundled into a single executable file using Bun's build system.
