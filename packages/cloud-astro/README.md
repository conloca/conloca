# `@conloca/cloud-astro`

Astro integration that compiles the site's Puck config into an editor bundle, registers each build at `endpoint`, and
serves draft previews. Add it to the site's `astro.config.mjs` to:

1. Compile the site's puck config into a single editor bundle under `dist/_conloca/`
   (react/react-dom/jsx-runtime/`@puckeditor/core` stay external — the editor supplies them at runtime) and register the
   build at `endpoint`.
2. Run a recursive preview build that emits SSR routes for draft content.
3. Wire preview SSR middleware that checks `/conloca_preview_<secret>/*` requests against the endpoint's token issuer
   and serves draft pages.
4. Expose `PreviewContentAPI` for `.astro` pages to fetch draft content.

## Usage

```js
// astro.config.mjs
import { conlocaCloud } from '@conloca/cloud-astro';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://www.example.com',
  output: 'server',
  integrations: [
    conlocaCloud({
      endpoint: 'https://cms.example.com',
      puckConfigPath: './src/puck.config.tsx',
      // CONLOCA_BUILD_TOKEN is the only identity setting; the repo comes from
      // CI metadata or the Git remote.
      // Bake the token issuer in so the preview deployment needs no env vars:
      // saasIssuer: 'https://auth.example.com',
      // publicBaseUrl: 'https://www.example.com', // falls back to CF_PAGES_URL
      // Optional: route previews through a dedicated preview domain instead
      // of the same-domain runtime. Leaves the production routes untouched.
      // previewDomain: 'preview.example.com',
      // previewBuild: false,  // explicit opt-out
    }),
  ],
});
```

See [`../../example/website-with-cms/astro.config.mjs`](../../example/website-with-cms/astro.config.mjs) for a working
integration.

## Options

| Name                   | Required | Description                                                                                                   |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `endpoint`             | yes      | Editor endpoint, e.g. `https://cms.example.com`. URL-shape validated.                                         |
| `puckConfigPath`       | yes      | Puck config entry to compile (same option name as `@conloca/astro-cms`).                                      |
| `repoUri`              | no       | Advanced `owner/repo` override; normally detected from CI or the Git remote.                                  |
| `siteId`               | no       | Advanced site-id override for CMS-less builds; sites.json is authoritative                                    |
| `buildToken`           | no       | Build token issued by the endpoint; prefer the `CONLOCA_BUILD_TOKEN` environment variable.                    |
| `siteStyles`           | no       | Site CSS compiled into the canvas stylesheet, as in `conlocaCMS`.                                             |
| `fragmentPreviewRoute` | no       | Content route for build-time style discovery, as in `conlocaCMS`.                                             |
| `publicBaseUrl`        | no       | Public site base URL for the bundle; falls back to `CF_PAGES_URL`.                                            |
| `previewDomain`        | no       | Dedicated preview domain. When set, switches to `preview-domain` mode.                                        |
| `previewBuild`         | no       | `PreviewBuildOptions` or `false` to opt out. Defaults to enabled.                                             |
| `saasIssuer`           | no       | JWT `iss` the preview middleware pins (the endpoint's token issuer). Baked in; else set at runtime.           |
| `requireRegistration`  | no       | Fail the build when registration is skipped for a missing prerequisite. Recommended in CI once setup is done. |

`conlocaCloud` is an add-on to `conlocaCMS`, not a replacement — keep both in `integrations`. The `conlocaCMS` options
`schemasPath` and `mdxComponentFolders` reach the editor at `endpoint` automatically: the CMS publishes what it resolved
and this integration compiles the schemas and the discovered MDX components into the editor bundle each build registers.
The `conlocaCMS` options `editorStyles` and `editorCSS` have no effect on the editor at `endpoint` (they configure the
local dev editor only); `templates` and the `routing` data bindings reach it through the same channel as `schemasPath`.

Set the token in whichever platform already runs `astro build`:

```sh
CONLOCA_BUILD_TOKEN=cbt_... astro build
```

No Conloca-specific GitHub Action or OIDC setup is required. GitHub Actions, Vercel, and GitLab provide repository
metadata automatically; elsewhere the integration reads `remote.origin.url`. Use `repoUri` only for a non-standard
checkout where neither source is available.

## Public render path

Zero runtime overhead in the site's PRODUCTION build — nothing from this package is mounted there. The preview route and
the preview interceptor exist only inside the generated preview build (below), so production pages render exactly as
they did before.

## Deploying the preview build

This is the part that is easy to miss: **`astro build` produces the preview app, but it does not deploy it.** Until you
deploy and route it, preview links resolve to nothing and the editor's Preview button appears to do nothing.

What the build produces when `CONLOCA_BUILD_TOKEN` is set:

1. Your normal site in `dist/` — unchanged.
2. A second, SSR app in `.conloca/preview-server/` — this is the preview app. It is a full server app (Node by default;
   pass `previewBuild.adapter` for another host). It lives OUTSIDE `dist/` because it bakes the preview secret: a
   wholesale static upload of `dist/` must never be able to publish it. Add `.conloca/` to `.gitignore`.

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

**The preview app cannot yet be built with `@astrojs/cloudflare`:** the adapter evaluates the site's module graph inside
workerd even with `prerenderEnvironment: 'node'`, and the CMS's content loaders need Node (`require is not defined`).

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

### Checking it works

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

| Check | What it verifies                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CC1   | `conlocaCloud(...)` is wired next to `conlocaCMS(...)` (an absent `conlocaCMS` is an error)                                                                  |
| CC2   | A build token is available (`CONLOCA_BUILD_TOKEN`; missing = error under CI, info locally) and parses as `cbt_…` (skipped when `conlocaCloud` is not called) |
| CC3   | `endpoint` is a valid https URL (no trailing slash); `publicBaseUrl`/`previewDomain` when set, or `CF_PAGES_URL` under CI; skipped likewise                  |
| CC4   | `conlocaCMS` options the endpoint's editor ignores (`editorStyles`, `editorCSS`)                                                                             |
| CC5   | `--live`: the endpoint answers the token (a 401 means a rotated token — create a new one and update the CI secret — or an endpoint without the status route) |
| CC6   | `--live`: a registration serves this branch and site — own row, inherited from the default branch, or none                                                   |
| CC7   | `--live`: the editor bundle the registration names is still deployed (catches a later deploy deleting it) and how stale it is                                |

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
preview reader (304 fallback, embedded payloads), and the site middleware's verdict rendering. End-to-end consumption
shape exercised via the example app (`example/website-with-cms/astro.config.mjs`).

## What's NOT in this package

- OAuth handshake (redirect, code exchange, refresh rotation) — handled by the endpoint.
- The token issuer and its JWKS endpoint (served by `endpoint`).
