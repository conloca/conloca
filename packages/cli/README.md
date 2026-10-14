# @conloca/cli

Command-line interface for Conloca content management.

## Installation

```bash
npm install -g @conloca/cli
# or
bun add -g @conloca/cli
```

## Usage

### Create a Project

Create a new Astro site with Conloca CMS wired in, from an empty directory:

```bash
conloca create <directory> [--site <site>] [--pm <manager>] [--no-install] [--no-git] [--json]
```

This writes a complete project — `package.json`, `astro.config.mjs` with `conlocaCMS()` wired, `tsconfig.json`,
`src/content.config.ts`, the starter components and Puck config, a first page at `/`, the agent skill, and a GitHub
Actions workflow that passes a `CONLOCA_BUILD_TOKEN` secret from the repository to the doctor and build steps (never to
dependency install scripts) and builds a pull request's own commit. Nothing in this scaffold reads that secret; the slot
is there for an integration that builds with a token. Then it installs dependencies, runs `git init`, and runs
`conloca doctor` on the result. It refuses a non-empty directory; for an existing site use `conloca astro setup`.

`--site` defaults to `default`. `--pm` takes `bun`, `npm`, `pnpm` or `yarn` and defaults to the package manager that
launched the CLI — `bunx` selects bun, `npx` npm, `pnpm dlx` pnpm — falling back to `npm`. Installing and `git init` are
on unless you pass `--no-install` or `--no-git`, and the command never prompts.

`--json` prints one object: `{ok, directory, packageManager, created, install, git, doctor: {ok, problems}}`.

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
- `src/schemas/data.ts` - Example Zod schemas for data collections
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

Astro checks, when an `astro.config.mjs`/`.ts`/`.js` is present (the config is read as text, never executed):

- the content config registers Conloca's collections
- `conlocaCMS` is imported from `@conloca/astro-cms/node` and its options carry `contentRoot`, `puckConfigPath`, and a
  `routing` block or `layout`
- `react()` is in `integrations` and comes before `conlocaCMS()`
- the `zod` and `@vitejs/plugin-react` peers are declared in `package.json`
- `tsconfig.json` sets `compilerOptions.jsx` to `react-jsx` (advisory — a warning only)
- with `output: 'server'`, every file under `src/pages` declares `prerender`
- no static `src/pages/index.astro` shadows the CMS home page

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
✓ C11 no static page shadows the CMS home

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

### Create a Page

Create an empty Puck page in a site's default locale:

```bash
conloca page create --site <site> --collection <collection> --pathname <pathname> --title <title> [path] [--json]
```

| Argument / Option           | Description                                       | Default                 |
| --------------------------- | ------------------------------------------------- | ----------------------- |
| `path`                      | Project directory holding the content root        | `.` (current directory) |
| `--site <site>`             | Site the page belongs to (a key in `sites.json`)  |                         |
| `--collection <collection>` | Collection directory under the site, e.g. `pages` |                         |
| `--pathname <pathname>`     | Page route, must start with `/`                   |                         |
| `--title <title>`           | Page title (`meta.title`)                         |                         |
| `--json`                    | Report as a single JSON object on stdout          |                         |

Writes a new `.vxjson` file under `<content root>/<site>/<collection>` with the same empty Puck payload the CMS writes
for a new page, then prints the page id and the created file path. It exits 1 when the site is unknown, the pathname is
invalid or already taken, or the write fails; validation failures name the offending option. `--json` prints
`{ok, id, path}` on success and `{ok: false, error, field?}` on failure — stdout carries exactly that one object,
progress lines go to stderr.

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
npm install @conloca/astro-cms @conloca/content-api @conloca/mdx @puckeditor/core @astrojs/react @vitejs/plugin-react zod
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
