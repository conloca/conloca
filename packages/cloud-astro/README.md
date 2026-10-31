# `@conloca/cloud-astro`

Astro integration that adds the editor page for Conloca's workspace editor to a site's build. Add it to the site's
`astro.config.mjs` next to `conlocaCMS` to:

1. Write the editor page to `/_conloca/editor/` in every build: the site's Puck config compiled into one bundle
   (react/react-dom/jsx-runtime/`@puckeditor/core` stay external — the workspace editor supplies them at runtime), its
   styles, the MDX sandbox frame and `conloca.json`. The page carries no credential.
2. When `previewBuild` is given as an object, build the preview server that renders drafts: next to a static site on
   Cloudflare Workers (under `/_conloca/preview/<branch>/`), on the site's own server deploy, or as a separate deploy.
3. Wire preview middleware that admits only passes signed by the endpoint, for the repository, site and branch the
   preview build was made from.
4. Expose `PreviewContentAPI` for `.astro` pages to fetch draft content.
5. Show share links: a viewer sees who shared the draft and when the link expires; an expired, turned-off, published or
   discarded link shows its own page.

Items 2 to 5 stay off unless `previewBuild` is given as an object (see [Draft previews](#draft-previews)).

## Setup

Before you start you need:

- An Astro site in a GitHub repository.
- The repository connected to your workspace editor at `<slug>.conloca.com`: sign in there with **Continue with
  GitHub**, choose **Connect GitHub**, and pick the repository on GitHub's installation screen. If a GitHub organization
  owns the repository and you are not one of its owners, an owner has to approve the installation; until then the editor
  shows **Waiting for approval**.
- A place the site is deployed to, at an address visitors reach without signing in. The workspace editor edits the
  deployed site: it opens the editor page your build adds under `/_conloca/editor/`, so editing starts after the first
  deploy. For editing before that, `astro dev` keeps the local editor at `/__cms`.

### 1. Run `conloca connect`

In the site's folder, or the repository holding it:

```sh
npx @conloca/cli connect
```

A coding agent can do the whole setup from one line:
`In my Astro site's folder, run npx @conloca/cli@<version> connect, then commit, push and deploy.`

`connect` adds `@conloca/astro-cms`, `@conloca/cloud-astro`, `@astrojs/react` and `@vitejs/plugin-react` with the
package manager of the nearest lockfile, wires `astro.config`, writes the site's host into `sites.json` (step 2), adds a
framing rule only where a committed header file forbids framing (step 3), builds the site once to check that the editor
page is there, and removes old build key lines from workflows. Every change is shown as a diff first: in a terminal it
asks once, `--yes` accepts without asking, and `--dry-run` writes nothing. A value you set yourself is kept and reported
as `differs`. It exits `2` with the lines to add when a step needs you, such as a config that is not a plain
`defineConfig({ integrations: [...] })`. `npx @conloca/cli connect --help` lists every option.

The config it wires:

```js
// astro.config.mjs
import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
import { conlocaCloud } from '@conloca/cloud-astro';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://www.example.com',
  // Keep your existing settings (output, adapter, ...) as they are.
  integrations: [
    react(),
    conlocaCMS({
      contentRoot: './content',
      puckConfigPath: './src/puck.config.tsx',
      layout: './src/layouts/Layout.astro',
    }),
    conlocaCloud({ repoUri: 'your-org/your-site' }),
  ],
});
```

- `conlocaCloud()` needs no options. It takes `puckConfigPath` and `siteStyles` from `conlocaCMS`, and builds for the
  workspace editor at `https://app.conloca.com` (`endpoint`'s default).
- `connect` writes `repoUri` when the checkout's `origin` is on GitHub, so the editor page names its repository even
  where the build has no git remote. Without it, the build reads the repository from GitHub Actions, Vercel or GitLab,
  else from the checkout's `remote.origin.url`.
- `conlocaCloud` is an add-on to `conlocaCMS`, not a replacement: keep both, with `react()` first. Doctor reports a
  config without `conlocaCMS` as an error.
- Nothing changes `output` or adds an adapter: a static site stays static.

By hand: on a site without `conlocaCMS`, run `npx @conloca/cli astro setup` first. Then
`bun add @conloca/astro-cms @conloca/cloud-astro` (plus the React peers), add `conlocaCloud()` right after
`conlocaCMS(...)`, and follow steps 2 and 3. `@conloca/cloud-astro` needs Astro 7.3.1 or a later 7.x release, and
`@conloca/astro-cms` at its own version: the `@conloca/*` packages are released together, so keep them on one version
and update them together.

### 2. Your site's host in `sites.json`

The workspace editor opens `https://<host><base>_conloca/editor/`. `<host>` is `domains[defaultLocale]` of the site
named `default` in `sites.json` (or of the only site), and `<base>` is that site's `base`, `/` when unset:

```json
"default": {
  "locales": ["en"],
  "defaultLocale": "en",
  "domains": { "en": "www.example.com" }
}
```

- `connect` writes `domains` from Astro's `site`, and `base` from Astro's `base` when it is not `/`. When `astro.config`
  sets no plain `site`, pass the address: `npx @conloca/cli connect --site-url https://www.example.com`. `connect` never
  writes Astro's `site` itself, since that changes canonical URLs and sitemaps.
- The host is a bare host such as `www.example.com`: no scheme, port or path. The editor never opens an IP address,
  `localhost` or a host under `conloca.com`.
- Use the address visitors reach. A deploy that asks visitors to sign in, such as a Vercel preview behind Deployment
  Protection, cannot be opened by the editor.

### 3. Framing headers, only if your site forbids framing

The workspace editor shows `/_conloca/editor/` in a frame. A site that sends no `X-Frame-Options` and no
`frame-ancestors` can already be framed, so there is nothing to do; GitHub Pages sends neither. When a committed
`public/_headers`, `netlify.toml` or `vercel.json` sets one of them for the whole site, `connect` adds a rule for
`/_conloca/editor/`, and until one exists the build warns and `conloca doctor` reports CC10. The rules:

- **Cloudflare Pages and Cloudflare Workers static assets**, in `public/_headers` after any site-wide `/*` rule:

  ```plain
  /_conloca/editor/*
    ! X-Frame-Options
    ! Content-Security-Policy
    Content-Security-Policy: frame-ancestors 'self' https://*.conloca.com

  /_conloca/editor/sandbox-frame.html
    Content-Security-Policy: sandbox allow-scripts
  ```

  `! Name` removes a header an earlier rule set. The site's own policy has to come off this path: two policies are both
  enforced, and the editor page carries its own.

- **Netlify**, in `public/_headers`. Netlify cannot remove a header, so the rule only adds the policy; a site-wide
  `X-Frame-Options` is then ignored by browsers, because `frame-ancestors` wins:

  ```plain
  /_conloca/editor/*
    Content-Security-Policy: frame-ancestors 'self' https://*.conloca.com

  /_conloca/editor/sandbox-frame.html
    Content-Security-Policy: sandbox allow-scripts
  ```

- **Vercel**, in the `headers` list of `vercel.json`:

  ```json
  [
    {
      "source": "/_conloca/editor/:path*",
      "headers": [{ "key": "Content-Security-Policy", "value": "frame-ancestors 'self' https://*.conloca.com" }]
    },
    {
      "source": "/_conloca/editor/sandbox-frame.html",
      "headers": [{ "key": "Content-Security-Policy", "value": "sandbox allow-scripts" }]
    }
  ]
  ```

- **A site-wide `Content-Security-Policy` with `frame-ancestors`**, on any host: a second policy cannot loosen it.
  Narrow it yourself so it does not cover `/_conloca/editor/`, then add the rule above. `connect` reports this case
  instead of editing a policy.
- **Headers set in host settings or by a server**, such as a proxy in front of an `@astrojs/node` server: exempt
  `/_conloca/editor/` there the same way. `connect` cannot see them; `conloca doctor --live` reads the deployed page's
  real headers (CC12).

### 4. Commit, push and deploy

`connect` never commits, pushes or deploys. Commit its changes, push to the default branch, and deploy the way you
always do. The build writes the editor page under `_conloca/editor/` in its output (`dist/_conloca/editor/` for a static
site, the client folder such as `dist/client/_conloca/editor/` for a server-rendered one) and logs
`editor page written: /_conloca/editor/`. It needs no secret and no environment variable.

On the default branch the workspace editor uses the components of the default branch's deploy. On any other branch it
uses the deploy whose code is closest to the branch's latest commit, among the branch's own deploys, the default
branch's and a build of the branch it was created from (on a tie, in that order), and the editor says which; see
[Branch deploys](#branch-deploys).

`/_conloca/editor/conloca.json` publishes the repository's name, the build's branch and commit, and whether the build
serves draft previews with the preview protocol it speaks (`preview`: `{ "mode": "d3", "protocol": 2 }` for a static
site with `previewBuild`, `d2` with an adapter, `d4` with `separate: true`, else `off`). If the repository is not
public, its name becomes public with the deploy. Protocol 2 opens a preview with a single-use `conloca_code` link that
the preview server trades for the pass with Conloca; a link that carries the pass itself (`conloca_preview`, protocol 1)
still opens in this release and stops opening in the next.

`conloca.json` also lists the build's prerendered page routes (`routes`, at most 500 and within 16 KiB for the whole
file), which the workspace editor offers when a site has no Conloca pages yet; they are public with the deploy, like the
pages themselves.

`/_conloca/editor/data-schemas.json` publishes the JSON schema of each `dataSchemas` collection, the metadata the
editor's entry forms already use, so agents can write data entries that match.

### CI example (GitHub Actions)

```yaml
# .github/workflows/deploy.yml
name: Build and deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bunx @conloca/cli doctor
      - run: bun run build
      # Deploy the build the way you already do.
```

### Branch deploys

On a branch other than the default one, the editor looks for that branch's own build: through the host's records on
GitHub (deployments, commit statuses, Cloudflare check runs) or its branch address. The deploy must be public for the
editor to frame it. Reading the records needs Conloca's GitHub App to have **Deployments**, **Commit statuses** and
**Checks** read access; an organization owner accepts that update on GitHub. Until then only the records go unread: a
Cloudflare Pages branch address still works. When no build of the branch is found, the editor uses an earlier build from
the branch's history (labelled as such), else the default branch's deploy, and says so.

| Host                                                                                         | Works when                                                                                                      | By default                                                                                                                                 | Found through                                                           |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Cloudflare Pages                                                                             | previews public (Access off) and branch builds not excluded                                                     | **works**                                                                                                                                  | check-run summary (needs permissions) or branch address (no permission) |
| Netlify                                                                                      | an open pull request from the same repository; previews public                                                  | PR deploy previews only, through commit statuses (needs permissions). Branch deploys are off; credit-based plans can make previews private | commit statuses (needs permissions)                                     |
| Vercel                                                                                       | Deployment Protection off for previews                                                                          | **protected**: the editor uses the default branch's deploy. Protection has been on by default since 2023-11                                | Deployment (needs permissions)                                          |
| Cloudflare Workers Builds                                                                    | previews enabled, an open pull request from the same repository, preview URL on Cloudflare's own preview domain | PR only                                                                                                                                    | bot PR comment (needs permissions)                                      |
| Render                                                                                       | PR previews enabled                                                                                             | off (manual trigger by default)                                                                                                            | Deployment created by a person (needs permissions)                      |
| S3, your own server or other static hosting with a public address per branch                 | an opt-in Actions job that posts a Deployment **on push**, for the built commit                                 | the default branch's deploy                                                                                                                | Deployment by `github-actions`                                          |
| GitHub Pages (no per-branch deploys), Amplify, Cloudflare Workers Previews on custom domains | —                                                                                                               | the default branch's deploy                                                                                                                | not supported                                                           |

**Cloudflare Pages not connected to a Git repository** (`wrangler pages deploy`): set `CONLOCA_PAGES_PROJECT` to the
first label of the site's `pages.dev` address (`my-site-4k2` for `my-site-4k2.pages.dev`) in the production build's
environment, so branch addresses are found. Use the address label, not the project name you gave `wrangler`: when that
name is taken, Cloudflare adds a suffix to the address, and setting the project name then silently finds no branch
address.

When two branch names clean up to the same Cloudflare Pages branch address, Pages gives the second one a random suffix.
The editor can't predict that address, so that branch shows the default branch's components unless its deploy is also
reported to GitHub (the Deployment step below).

**Vercel:** Deployment Protection has been on for previews by default since 2023-11. Turn it off for previews to let the
editor frame them, knowing that anyone with a preview URL can then see it.

**Any other host:** the editor frames a branch build at its own address with the site's production base, so a preview
under a subpath of one site can't work. Publish each branch build at its own public address (a second host or bucket
works), then add a step that posts a GitHub Deployment for the built commit, on `push`, with `GITHUB_TOKEN` and no other
secret:

```yaml
on: push
permissions:
  contents: read
  deployments: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      # … your build and deploy steps; the step with id `deploy` outputs `url` (https)
      - uses: actions/github-script@v7
        env:
          PREVIEW_URL: ${{ steps.deploy.outputs.url }}
        with:
          script: |
            const { owner, repo } = context.repo;
            const { data } = await github.rest.repos.createDeployment({
              owner, repo, ref: context.sha, environment: `preview/${context.ref_name}`,
              auto_merge: false, required_contexts: [],
            });
            await github.rest.repos.createDeploymentStatus({
              owner, repo, deployment_id: data.id, state: 'success', environment_url: process.env.PREVIEW_URL,
            });
```

A `pull_request` build checks out a merge commit, which never matches the branch's commit: build on `push`, or check out
`github.event.pull_request.head.sha` and pass that commit as `ref` instead of `context.sha`.

### Check it

After the deploy finishes, run this in your repository:

```sh
npx @conloca/cli doctor --live
```

`--live` reads the deployed `<host><base>_conloca/editor/conloca.json` and the page's headers, and the protocol range
the editor publishes at `https://app.conloca.com/host/protocols.json`, and judges them by the same rules the workspace
editor applies. It sends no credential, so it runs anywhere, pull requests from forks included.

Then open your workspace editor at `<slug>.conloca.com`. Until the editor page is live, **Connect this site** lists the
steps the site still needs: each row says what is done, whom it waits on, or what failed and how to fix it.

### Troubleshooting

Doctor names each check; the checklist in the workspace editor reports the same causes.

- **`sites.json` has no `domains` for the default locale, or not a bare host** (CC9). Run `connect`, or add your site's
  host there (step 2). A host under `conloca.com`, an IP address or `localhost` is refused.
- **A committed header file sets `X-Frame-Options` or `frame-ancestors` for the whole site** (CC10). Run `connect`, or
  add the rule from step 3.
- **The address cannot be reached, or answers 5xx or 429** (CC11). The site is down or limiting requests: check that it
  is deployed and serving, then try again later.
- **`conloca.json` is not deployed** (CC11). The address answers 404 or an HTML page: deploy the commit that adds
  `conlocaCloud()`, and check that `domains` names the address it is deployed to.
- **The address asks visitors to sign in** (CC11), for example Vercel Deployment Protection. Put the public production
  address in `sites.json`, or let visitors through.
- **The page names no repository** (CC11). The build could not read the git remote: set `repoUri` in `conlocaCloud(...)`
  (`connect` writes it from a checkout with a GitHub `origin`).
- **The address serves another repository's editor page, or another site** (CC11). Check `domains` and `siteId` in
  `sites.json`.
- **`conloca.json` is not one the editor can read** (CC11). The host changed the built file; serve it unchanged.
- **The page is serving an older commit than your checkout** (CC11, a warning). Deploy to see your latest components.
- **The deployed page sends `X-Frame-Options`, or a `frame-ancestors` that leaves out `https://*.conloca.com`** (CC12).
  Run `connect` again, or exempt `/_conloca/editor/` in your host settings (step 3).
- **The deployed page sends a `script-src` that does not allow `https://app.conloca.com`** (CC12). The page cannot load
  the editor, and the workspace editor stops waiting for it. Detach the site's policy on `/_conloca/editor/` (step 3),
  or add `https://app.conloca.com` to its `script-src` there.
- **The page's protocol is outside the range the editor speaks** (CC13). Rebuild with a newer `@conloca/cloud-astro` and
  deploy; if the page is newer than the editor, the editor does not speak that version yet.
- **A workflow or the config still names `CONLOCA_BUILD_TOKEN`, `buildToken`, `publicBaseUrl`, `previewDomain` or
  `requireRegistration`** (CC14). The editor page needs none of them: remove those lines. `connect` removes the workflow
  lines that only pass the key.

## Options

| Name             | Required | Description                                                                                                                                                     |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `endpoint`       | no       | The workspace editor's address, scheme and host only, no trailing slash; its host must start with `app.`. Defaults to `https://app.conloca.com`.                |
| `puckConfigPath` | no       | Puck config entry to compile. Defaults to the value `conlocaCMS` was given.                                                                                     |
| `repoUri`        | no       | Advanced `owner/repo` override; normally detected from CI or the Git remote.                                                                                    |
| `siteId`         | no       | Advanced site-id override for CMS-less builds; sites.json is authoritative.                                                                                     |
| `siteStyles`     | no       | Site CSS compiled into the canvas stylesheet, as in `conlocaCMS`.                                                                                               |
| `previewBuild`   | no       | `PreviewBuildOptions` or `false`. Off unless given as an object. See [Draft previews](#draft-previews). Refused under `@astrojs/vercel` and `@astrojs/netlify`. |
| `saasIssuer`     | no       | Draft previews only. Pins the JWT `iss` every pass must name; unset, passes are checked against the endpoint's keys alone.                                      |

The `conlocaCMS` options `schemasPath`, `mdxComponentFolders`, `templates`, the `routing` data bindings, `editorStyles`
and `editorCSS` reach the editor page automatically: the CMS publishes what it resolved, and the editor page renders
your pages with them as the local editor at `/__cms` does.

`buildToken`, `requireRegistration`, `publicBaseUrl`, `previewDomain`, `editorBundlePlugins` and `fragmentPreviewRoute`
were removed: a config that still names one fails at load. Run `npx @conloca/cli connect` to update it.

## Public render path

Zero runtime overhead in the site's PRODUCTION build — nothing from this package is mounted there. The preview route and
the preview interceptor exist only inside the generated preview build (below), so production pages render exactly as
they did before.

## Draft previews

The editor's Preview button opens the draft on your site. How depends on the site:

| Your site                                                              | `previewBuild`       | Where drafts render                                                                                                                                                     |
| ---------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static, deployed to Cloudflare Workers                                 | `{}`                 | Next to the site: a dispatcher runs only on `/_conloca/preview/*` and your on-demand routes. Every other page stays a static file, and no visitor to it starts a Worker |
| Static, on another host, or on Cloudflare without a domain of your own | `{ separate: true }` | A separate preview deploy; its address goes in `sites.json` `previewUrl`                                                                                                |
| Server-rendered (`@astrojs/cloudflare`, `@astrojs/node`)               | `{}`                 | Your own deploy                                                                                                                                                         |

### Next to a static site on Cloudflare Workers

Install `@astrojs/cloudflare` and add `previewBuild: {}` to `conlocaCloud(...)`, then run `npx @conloca/cli connect`. It
asks once whether your account is on the Cloudflare Workers Paid plan (pass `--cf-plan free` or `--cf-plan paid` when no
one is at the terminal) and records the answer in `package.json` (`"conloca": { "cfPlan": "paid" }`). It writes
`wrangler.jsonc`; on the Paid plan it adds the `ratelimits` entry below (Wrangler 4.36 or newer), on the Free plan it
leaves it out:

```jsonc
{
  "main": ".conloca/dispatcher/index.mjs",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "404-page",
    "run_worker_first": ["/_conloca/preview", "/_conloca/preview/*"],
  },
  "ratelimits": [
    { "name": "conlocaPreviewLimit", "namespace_id": "<chosen by connect>", "simple": { "limit": 60, "period": 10 } },
  ],
}
```

`run_worker_first` also lists every route the preview build renders on demand (API routes, Actions, and `/_image` for
draft images). Every build checks the list, and on the Paid plan the rate limit, and fails with "run
`conloca connect --update --yes`" when one is missing, so an API route can never silently 404 in production. A
`wrangler.toml` can't carry these settings: convert it to `wrangler.jsonc` first. Keep `main` and `assets` out of
`env.<name>` blocks; both are inherited from the top level. To try previews locally, run
`wrangler dev --local-protocol https`: Safari refuses the preview's `Secure` cookies on plain-http `localhost`.

If the preview build fails and `run_worker_first` lists only the two preview entries, the site still builds and deploys,
and `/_conloca/preview/` answers "Preview couldn't load the draft". If it also lists your on-demand routes, or
`not_found_handling` is `"none"`, the build fails instead: the preview server is what serves those routes, and shipping
without it would break them.

On the Cloudflare Workers Paid plan the dispatcher limits each visitor to 60 requests under `/_conloca/preview/` per 10
seconds (the `ratelimits` binding, counted per Cloudflare location and approximately) and answers "Too many preview
requests — try again in a few seconds" over it. On the Free plan there is no limit: a blocked request would still count
against the day's requests, so a limit adds nothing there. A flood can then use up the day's requests and pause preview
until 00:00 UTC, but never the published pages, which don't run the dispatcher. On the Free plan a site with API routes
previews on a separate deploy instead. A rate-limiting rule on `/_conloca/preview/*` in the Cloudflare dashboard
(Security → WAF) stops a flood before it reaches the dispatcher; it is optional, and doctor doesn't check it.

Not suited to this mode: sites that navigate on the client (view transitions, `navigate()`), call same-origin APIs that
should see drafts, load third-party tags that must not see draft content, open same-origin pages from scripts
(`window.open` would let the opener read a draft), or register a service worker that handles navigations (it would see
draft pages, and could cache them or answer published ones). Use a separate preview deploy.

### A separate preview deploy

Set `previewBuild: { separate: true }`. Your build then runs no preview build. Add a second deploy (for example a second
Cloudflare Workers Builds project) that builds with `CONLOCA_PREVIEW_BUILD=1` and its Wrangler environment set to
`preview` (the environment is chosen at build time, not at deploy) and deploys with a plain `wrangler deploy`. Put its
address in `sites.json`:

```json
{ "sites": { "default": { "previewUrl": { "en": "https://preview.example.com" } } } }
```

A workspace admin confirms the address in the editor once; from then on every preview link opens there.

## Doctor

This package is a `conloca doctor` extension (`conloca.doctor` in package.json): `conloca doctor` in a project that
depends on it runs this package's checks after the CMS ones, offline by default.

| Check | What it verifies                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CC1   | `conlocaCloud(...)` is wired next to `conlocaCMS(...)` (an absent `conlocaCMS` is an error); notes that the deployed `conloca.json` publishes the repository's name                                          |
| CC8   | `previewBuild` is absent or `false`, or the preview build has an SSR adapter (the project's own or `previewBuild.adapter`); `previewBuild` on a static project with neither is an error: `astro build` fails |
| CC9   | `sites.json` gives the site named `default` (or the only site) a bare host in `domains[defaultLocale]` and a valid `base`; Astro's `site` and `base`, when the config shows them, agree (warnings)           |
| CC10  | No committed `public/_headers`, `netlify.toml` or `vercel.json` sets `X-Frame-Options` or `frame-ancestors` for the whole site without a `/_conloca/editor/` rule; the error carries the rule to add         |
| CC11  | `--live`: `<host><base>_conloca/editor/conloca.json` is deployed, public, and names this repository and site; warns when it serves another commit than your checkout                                         |
| CC12  | `--live`: the deployed `/_conloca/editor/` may be framed by `https://*.conloca.com` and its `script-src` allows the editor's origin                                                                          |
| CC13  | `--live`: the page's protocol is in the range the editor publishes at `/host/protocols.json`                                                                                                                 |
| CC14  | No tracked workflow and not the astro config still names `CONLOCA_BUILD_TOKEN`, `buildToken`, `publicBaseUrl`, `previewDomain` or `requireRegistration` (warnings)                                           |

`conloca doctor --live` sends no credential: it contacts only your site's host and the editor's public
`/host/protocols.json`. When the config computes `endpoint` (for example from an environment variable), set
`CONLOCA_ENDPOINT` so doctor can read it.

The integration also scaffolds a one-page agent skill at `.claude/skills/conloca-cloud/SKILL.md` — in the nearest
`.claude/` directory between the Astro project and the git root — on any Astro command that loads the config (build,
dev, sync, check), once, never overwriting an existing file. Repos without a `.claude/` directory get nothing. Projects
outside a git repository get nothing either. `conloca upgrade` refreshes it; an edited page is kept and the new one
written beside it as `SKILL.new.md`.

## Tests

```sh
nx run cloud-astro:test
```

Covers option validation, integration shape (which hooks are registered), preview build (spawned binary path + env
contract), preview middleware (JWT verification, 302/cookie/landing-page paths, banner injection, robots headers),
preview reader (304 fallback, embedded payloads), and the site middleware's verdict rendering. The `test-packed` target
installs the packed tarball in an empty project and resolves every export from it there.

## What's NOT in this package

- OAuth handshake (redirect, code exchange, refresh rotation) — handled by the endpoint.
- The token issuer and its JWKS endpoint (served by `endpoint`).
