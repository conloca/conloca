# `@conloca/cloud-astro`

Astro integration that connects a Conloca CMS site to an editor endpoint. Add it to the site's `astro.config.mjs` next
to `conlocaCMS` to:

1. Compile the site's Puck config into a single editor bundle under `_conloca/` in the build output
   (react/react-dom/jsx-runtime/`@puckeditor/core` stay external — the editor supplies them at runtime) and register the
   build at `endpoint`, so the editor there loads this build's bundle for the branch it was built from.
2. Run a recursive preview build that emits SSR routes for draft content.
3. Wire preview SSR middleware that checks `/conloca_preview_<secret>/*` requests against the endpoint's token issuer
   and serves draft pages.
4. Expose `PreviewContentAPI` for `.astro` pages to fetch draft content.

## Setup

Before you start you need:

- An Astro site that already runs `@conloca/astro-cms` (its README covers that), in a GitHub repository.
- The repository connected to the editor at `endpoint`: sign in there with **Continue with GitHub**, choose **Connect
  GitHub**, and pick the repository on GitHub's installation screen. If a GitHub organization owns the repository and
  you are not one of its owners, an owner has to approve the installation; until then the editor shows **Waiting for
  approval**.
- An owner or admin role in the editor's workspace: only they can create the build token in step 3. Whoever sets the
  workspace up becomes its first owner.

### 1. Install

```sh
bun add @conloca/cloud-astro
```

It needs Astro 7.3.1 or a later 7.x release. Its other peers (`@astrojs/react`, `@conloca/astro-cms`, `vite`) are
already in a site that runs `@conloca/astro-cms`.

### 2. Add it next to `conlocaCMS`

```js
// astro.config.mjs
import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
import { conlocaCloud } from '@conloca/cloud-astro';
import { defineConfig } from 'astro/config';

export default defineConfig({
  // Keep your existing settings (output, adapter, ...) as they are.
  integrations: [
    react(),
    conlocaCMS({
      contentRoot: './content',
      puckConfigPath: './src/puck.config.tsx',
      layout: './src/layouts/Layout.astro',
    }),
    conlocaCloud({
      endpoint: 'https://cms.example.com',
      puckConfigPath: './src/puck.config.tsx',
      publicBaseUrl: 'https://www.example.com',
      previewBuild: false,
    }),
  ],
});
```

- `conlocaCloud` is an add-on to `conlocaCMS`, not a replacement: keep both, with `react()` first. Doctor reports a
  config without `conlocaCMS` as an error.
- `endpoint` is only the scheme and host of the address you open the editor at, such as `https://cms.example.com`. Leave
  out any path the browser's address bar shows after the host, and the trailing slash.
- `puckConfigPath` is the value you already gave `conlocaCMS`. If your `conlocaCMS` options also set `siteStyles` or
  `fragmentPreviewRoute`, give `conlocaCloud` the same values, so the editor renders your pages with your site's styles.
- `publicBaseUrl` is the address your deployed site is served from: the editor loads this build's editor files from
  there. The integration does **not** read Astro's `site` option, so set `publicBaseUrl` even when `site` holds the same
  address. Its only fallback is `CF_PAGES_URL`, which Cloudflare Pages sets when it runs the build itself. Without
  either, the build succeeds but does not register, and the editor never updates.
- `previewBuild: false` turns off the second build that serves draft previews. Keep it off while you connect: that build
  needs an SSR adapter (the project's own, or `previewBuild.adapter`), so on a static site without one it fails the
  build, and what it produces is a separate app you deploy and route yourself (see [Draft previews](#draft-previews)).

### 3. Give the build a token

In the editor at `endpoint`, open the account menu (the round button with your initial), choose **Workspace settings**,
and go to **Build token**. The **Connect this site** screen of a site that has no build yet shows the same section.
Choose **Create build token**. The token is shown once, as the line `CONLOCA_BUILD_TOKEN=cbt_…`, and **Copy environment
variable** copies that whole line. Store it wherever `astro build` runs:

- Where the name and the value are separate fields — a GitHub Actions secret, a Cloudflare Pages variable, most hosts'
  settings — the name is `CONLOCA_BUILD_TOKEN` and the value is **only** the part after `CONLOCA_BUILD_TOKEN=`, starting
  with `cbt_`. Do not paste the whole copied line as the value.
- Where the input takes `NAME=value` lines, like a `.env` file, paste the whole line.

Give the secret only to the steps that need it: `conloca doctor` and the build (see the
[CI example](#ci-example-github-actions)), not to install scripts or deploy actions. Never write it into the config:
doctor warns when `buildToken` is committed.

One token serves the whole workspace. **Replace build token** creates a new one, and the old one stops working at once,
so update every place that holds it.

No Conloca-specific GitHub Action or OIDC setup is required. GitHub Actions, Vercel and GitLab provide the repository
automatically; elsewhere the integration reads the checkout's `remote.origin.url`. Use `repoUri` only for a checkout
where neither is available.

A build without the token still succeeds; it only skips registration (see
[When registration is skipped](#when-registration-is-skipped)). Once your CI is wired, set `requireRegistration: true`
so a deploy can never silently leave the editor behind.

### 4. Push, then build

A build registers the exact commit it was built from, and the endpoint refuses a commit it has not received from GitHub
yet. Push first, then build the pushed commit; a CI build that starts on push does this for you. A build of a commit the
endpoint does not have retries for about two and a half minutes and then fails with an error that says the commit
`is not ingested`. A local `astro build` of an unpushed commit with the token set fails the same way.

If you also build pull requests on GitHub Actions, give `actions/checkout` the pull request's own commit
(`ref: ${{ github.event.pull_request.head.sha || github.sha }}`). By default it checks out a merge commit that GitHub
makes for the pull request and never pushes, so the endpoint never receives it and the registration fails.

A pull-request build deployed somewhere other than `publicBaseUrl`, such as a host's preview deploy, must set
`publicBaseUrl` to the address that build is served from, for example from your host's deploy-URL variable (a full
`https://` address). The editor on that branch loads the build's editor files from `publicBaseUrl`, and your production
site does not serve the files only a pull request's build produced, so the editor would report that the bundle could not
be loaded or verified.

### 5. Deploy, and serve `/_conloca/*` cross-origin

The build writes the editor files under `_conloca/` in its output: `dist/_conloca/` for a static site, or the client
folder such as `dist/client/_conloca/` for a server-rendered one. Deploy the build the way you already do, to the
`publicBaseUrl` address.

The editor runs on another origin and fetches those files from your site, so every `/_conloca/*` response must be public
and carry `Access-Control-Allow-Origin: *`. Without the header the editor reports that this build's editor bundle could
not be loaded or verified, and rebuilding does not help.

The build writes that rule to a `_headers` file next to `_conloca/` (`dist/_headers`, or `dist/client/_headers` for a
server-rendered site): one rule for `/_conloca/*`, plus one for each folder of fonts and images your site styles
reference.

- **Cloudflare Pages and Netlify** apply `_headers` themselves. Nothing else to do.
- **Everywhere else**, `_headers` is ignored — including a Node server built with `@astrojs/node`, which reads only its
  own `_headers.json`. Set the header for every path the generated `_headers` lists, in whatever serves the site. With
  Caddy in front of the Node server:

  ```caddyfile
  www.example.com {
  	header /_conloca/* Access-Control-Allow-Origin *
  	reverse_proxy localhost:4321
  }
  ```

  With nginx in front of it:

  ```nginx
  location /_conloca/ {
      add_header Access-Control-Allow-Origin * always;
      proxy_pass http://127.0.0.1:4321;
  }
  ```

  If nginx serves the files itself, keep your `root` or `try_files` lines in that `location` instead of `proxy_pass`. A
  `location` with its own `add_header` drops the ones it would inherit from the `server` block, so repeat any you rely
  on.

Check it after the deploy, with the file name from the build log line
`editor bundle written: /_conloca/editor-bundle.<hash>.js`:

```sh
curl -sI -H 'Origin: https://cms.example.com' https://www.example.com/_conloca/editor-bundle.<hash>.js
```

The answer must be `200` and include `access-control-allow-origin: *`. `conloca doctor --live` checks that the file is
deployed, not this header.

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
      # The token goes to doctor and the build only, not to install scripts or the deploy.
      - run: bunx @conloca/cli doctor
        env:
          CONLOCA_BUILD_TOKEN: ${{ secrets.CONLOCA_BUILD_TOKEN }}
      - run: bun run build
        env:
          CONLOCA_BUILD_TOKEN: ${{ secrets.CONLOCA_BUILD_TOKEN }}
      # Deploy the build the way you already do.
```

### Check it

After the deploy finishes, run this in your repository, on the branch you built:

```sh
CONLOCA_BUILD_TOKEN=cbt_... bunx @conloca/cli doctor --live
```

`--live` asks the endpoint what it knows about this repository: whether it accepts the token, which commit registered
the editor for this branch and site and which version of this package built it, and whether that editor bundle is still
deployed. The token goes only to the `endpoint` in your config. If you did not keep a copy of the token, skip this step
rather than replacing the token (that stops the CI secret working at once); reloading the editor is enough.

Then reload the editor: it opens your site instead of **Connect this site**, and the **Build registration** row under
**Workspace settings → Build token** turns from **Waiting for Astro build** to **Connected**.

### Troubleshooting

- **The build log ends with `editor at … NOT updated by this build`.** A prerequisite was missing, and the `missing:`
  line names it: `public base URL` means `publicBaseUrl` is not set (step 2), `build token` means the
  `CONLOCA_BUILD_TOKEN` secret does not reach the build (step 3). See
  [When registration is skipped](#when-registration-is-skipped).
- **Doctor says the build token value starts with `"CONLOCA_BUILD_TOKEN="`, or the build fails with
  `registration rejected: HTTP 401` and the secret holds the whole copied line.** Change the value to the part starting
  with `cbt_` and rebuild. The token itself is fine; you do not need a new one.
- **`registration rejected: HTTP 401` with a `cbt_…` value.** The token was replaced, which invalidates the old one at
  once. Put the new token in the `CONLOCA_BUILD_TOKEN` secret everywhere the site builds, then rebuild.
- **The build fails with an error that says the commit `is not ingested`.** It built a commit the endpoint has not
  received. Push the commit, then rebuild (step 4).
- **`registration rejected: HTTP 403` saying the repository is not covered by the workspace's GitHub installation.** Add
  the repository to that installation in your GitHub settings, then rebuild.
- **The build log shows `registration complete`, but the editor still shows Connect this site.** Wait for the deploy to
  finish, then reload the editor.
- **The editor says the editor bundle could not be loaded or verified.** `/_conloca/*` lacks the cross-origin header,
  `publicBaseUrl` does not serve this build's files, or the deploy has not finished (step 5).

## Options

| Name                   | Required | Description                                                                                                                          |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `endpoint`             | yes      | Editor endpoint, scheme and host only, e.g. `https://cms.example.com`: no path, no trailing slash. URL-shape validated.              |
| `puckConfigPath`       | yes      | Puck config entry to compile (same option name and value as in `@conloca/astro-cms`).                                                |
| `publicBaseUrl`        | no       | Where the deployed site is served; the editor loads the bundle from there. Astro's `site` is not read. Falls back to `CF_PAGES_URL`. |
| `repoUri`              | no       | Advanced `owner/repo` override; normally detected from CI or the Git remote.                                                         |
| `siteId`               | no       | Advanced site-id override for CMS-less builds; sites.json is authoritative.                                                          |
| `buildToken`           | no       | Build token issued by the endpoint; use the `CONLOCA_BUILD_TOKEN` environment variable instead, so it is never committed.            |
| `siteStyles`           | no       | Site CSS compiled into the canvas stylesheet, as in `conlocaCMS`.                                                                    |
| `fragmentPreviewRoute` | no       | Content route for build-time style discovery, as in `conlocaCMS`.                                                                    |
| `previewDomain`        | no       | Dedicated preview domain. When set, switches to `preview-domain` mode and is used instead of `publicBaseUrl`.                        |
| `previewBuild`         | no       | `PreviewBuildOptions` or `false`. On by default; needs the project's SSR adapter or `previewBuild.adapter`, else set `false`.        |
| `saasIssuer`           | no       | JWT `iss` the preview middleware pins (the endpoint's token issuer). Baked in; else set at runtime.                                  |
| `requireRegistration`  | no       | Fail the build when registration is skipped for a missing prerequisite. Recommended in CI once setup is done.                        |

The `conlocaCMS` options `schemasPath` and `mdxComponentFolders` reach the editor at `endpoint` automatically: the CMS
publishes what it resolved and this integration compiles the schemas and the discovered MDX components into the editor
bundle each build registers. The `conlocaCMS` options `editorStyles` and `editorCSS` have no effect on the editor at
`endpoint` (they configure the local dev editor only); `templates` and the `routing` data bindings reach it through the
same channel as `schemasPath`.

## Public render path

Zero runtime overhead in the site's PRODUCTION build — nothing from this package is mounted there. The preview route and
the preview interceptor exist only inside the generated preview build (below), so production pages render exactly as
they did before.

## Draft previews

This is the part that is easy to miss: **`astro build` produces the preview app, but it does not deploy it.** Until you
deploy and route it, preview links resolve to nothing and the editor's Preview button appears to do nothing.

What a build that registers produces when `previewBuild` is not `false`:

1. Your normal site in `dist/` — unchanged.
2. A second, SSR app in `.conloca/preview-server/` — this is the preview app. It is built with the project's own
   adapter, or with `previewBuild.adapter` when the project has none (a project with its own adapter must not set one:
   Astro allows one adapter per build). A static project without either fails the build. The preview app lives OUTSIDE
   `dist/` because it bakes the preview secret: a wholesale static upload of `dist/` must never be able to publish it.
   Add `.conloca/` to `.gitignore`.

To make preview work you must:

1. **Deploy `.conloca/preview-server/` as its own app**, alongside your site.
2. **Route `/conloca_preview_*` on your site's domain to it.** Everything else stays on your normal site. Preview must
   be reachable on the SAME origin as the site — the preview cookie is origin-scoped, and a different origin cannot read
   it.
3. **Set `CONLOCA_SAAS_ISSUER`** on that deployment (the `iss` of the JWTs the endpoint signs). Everything else — the
   preview secret, the endpoint, the audience — is baked into the artifact at build time. Set `saasIssuer` in
   `conlocaCloud()` and the deployment needs no environment variables at all.

Any of `CONLOCA_PREVIEW_SECRET`, `CONLOCA_SAAS_ENDPOINT`, `CONLOCA_SAAS_AUDIENCE`, `CONLOCA_SAAS_ISSUER` set on the
deployment overrides the baked value, so one artifact can be promoted across environments without a rebuild.

**A fully static site cannot preview drafts.** A draft does not exist at build time, so rendering it requires something
running at request time. This is not a Conloca limitation — Next.js Draft Mode is likewise unsupported with static
export, and every CMS with a comparable feature requires a runtime.

### When registration is skipped

A build that lacks a prerequisite — no `CONLOCA_BUILD_TOKEN`, no repository identity, no git sha/branch, or no public
base URL — completes without registering and ends with one summary block:

```plain
[@conloca/cloud-astro] editor at https://cms.example.com NOT updated by this build
  missing: build token (set buildToken or CONLOCA_BUILD_TOKEN)
  consequence: registration was skipped, so the editor keeps serving the previous build of this branch (or the default branch's, or nothing, if neither was ever registered)
  check: conloca doctor --live
```

Set `requireRegistration: true` in CI to turn that into a build failure. An attempted registration that the endpoint
rejects always fails the build; there is no switch for that.

### Checking draft previews

Open a preview link. The first request carries the token in the query string and should answer `302` with a
`Set-Cookie: conloca_preview_<secret>=…` and a `Location` pointing at the **clean** path (no secret prefix). After that
the cookie carries the preview across internal links.

If preview pages render as ordinary published pages, the preview app is running but unconfigured — it logs once at
startup:

```plain
[@conloca/cloud-astro] draft preview is INERT — <reason>
```

It deliberately fails open (serving the published site) rather than erroring, so a misconfigured preview never takes the
site down.

## Doctor

This package is a `conloca doctor` extension (`conloca.doctor` in package.json): `conloca doctor` in a project that
depends on it runs this package's checks after the CMS ones, offline by default.

| Check | What it verifies                                                                                                                                                                                                              |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CC1   | `conlocaCloud(...)` is wired next to `conlocaCMS(...)` (an absent `conlocaCMS` is an error)                                                                                                                                   |
| CC2   | A build token is available (`CONLOCA_BUILD_TOKEN`; missing = error under CI, info locally) and parses as `cbt_…`, with its own message for a pasted `CONLOCA_BUILD_TOKEN=` prefix (skipped when `conlocaCloud` is not called) |
| CC3   | `endpoint` is a valid https URL (no trailing slash); `publicBaseUrl`/`previewDomain` when set, or `CF_PAGES_URL` under CI; skipped likewise                                                                                   |
| CC4   | `conlocaCMS` options the endpoint's editor ignores (`editorStyles`, `editorCSS`)                                                                                                                                              |
| CC5   | `--live`: the endpoint accepts the token (a 401 means a replaced token — put the new one in the CI secret — or an endpoint without the status route)                                                                          |
| CC6   | `--live`: a registration serves this branch and site — own row, inherited from the default branch, or none                                                                                                                    |
| CC7   | `--live`: the editor bundle the registration names is still deployed (catches a later deploy deleting it) and how stale it is; it does not check the cross-origin header                                                      |

`conloca doctor --live` sends the build token ONLY to the configured endpoint. When the config computes `endpoint` (for
example from an environment variable), set `CONLOCA_ENDPOINT` so doctor can read it.

The integration also scaffolds a one-page agent skill at `.claude/skills/conloca-cloud/SKILL.md` — in the nearest
`.claude/` directory between the Astro project and the git root — on any Astro command that loads the config (build,
dev, sync, check), once, never overwriting an existing file. Repos without a `.claude/` directory get nothing. Projects
outside a git repository get nothing either. The page is not auto-updated: copy the current one from this package's
`src/skill/SKILL.md` when it changes.

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
