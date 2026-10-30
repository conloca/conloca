---
name: conloca-cloud
description: Load when a Conloca site uses @conloca/cloud-astro — conloca connect, the editor page, framing, doctor.
---

# Connecting a site to the workspace editor

`conlocaCloud()` from `@conloca/cloud-astro` is an add-on to `conlocaCMS(...)` — keep both in `integrations`, after
`react()`. It needs no options: it takes `puckConfigPath` and `siteStyles` from `conlocaCMS` and builds for the
workspace editor at `https://app.conloca.com`. Each `astro build` adds the editor page under `_conloca/editor/` in the
output; the workspace editor at `<slug>.conloca.com` opens the deployed page in a frame. Nothing else of it runs on the
published site. There is no build key, secret or environment variable.

## Set up: connect → commit → push → deploy → open

```bash
npx @conloca/cli connect          # in the site's folder; add --yes when no terminal can answer
```

`connect` installs the packages, wires `astro.config` (writing `repoUri` from a GitHub `origin`), writes the site's host
into `sites.json`, adds a framing rule only where a committed header file forbids framing, builds once to check the
editor page, and removes old build key lines from workflows. It shows diffs first, keeps values you set (`differs`), and
exits `2` with the lines to add when a step needs a person (`--site-url https://…` when `astro.config` has no `site`).
It never commits, pushes or deploys: commit, push to the default branch, deploy as usual, then open the workspace
editor. Editing needs the deployed site; before that, `astro dev` serves the local editor at `/__cms`.

## First move: `conloca doctor --live`

For any question about the workspace editor — "Connect this site" stays, the frame stays blank, old components after a
deploy — run this before reading source:

```bash
conloca doctor --live     # sends no credential: only your site's host and the editor's /host/protocols.json
conloca doctor            # offline: wiring, sites.json host, committed framing headers, key leftovers
```

This package's checks are `CC1` and `CC8`–`CC14`:

- **CC9** — `sites.json`: the site named `default` (or the only one) has a bare host in `domains[defaultLocale]` and a
  valid `base`. The editor opens `https://<host><base>_conloca/editor/`; it refuses IPs, `localhost`, `*.conloca.com`.
- **CC10** — a committed `public/_headers`, `netlify.toml` or `vercel.json` sets `X-Frame-Options` or `frame-ancestors`
  site-wide with no `/_conloca/editor/` rule. Fix: `connect`, or the rule the error prints.
- **CC11** (live) — `conloca.json` is deployed, public, and names this repository and site. "names no repository" → set
  `repoUri` in `conlocaCloud(...)`. Serving an older commit than HEAD is a warning: deploy.
- **CC12** (live) — the deployed page may be framed by `https://*.conloca.com`, and its `script-src` allows the editor's
  origin. Headers from host settings or a proxy show up only here.
- **CC13** (live) — the page's protocol is in the editor's range; too old → rebuild with a newer `@conloca/cloud-astro`.
- **CC14** — a workflow or the config still names `CONLOCA_BUILD_TOKEN`, `buildToken`, `publicBaseUrl`, `previewDomain`
  or `requireRegistration`. Remove them; nothing reads them for the editor page.

## Framing: only when the site forbids it

A site sending no `X-Frame-Options` and no `frame-ancestors` needs nothing (GitHub Pages included). Otherwise
`/_conloca/editor/*` needs `Content-Security-Policy: frame-ancestors 'self' https://*.conloca.com`, plus
`/_conloca/editor/sandbox-frame.html` → `Content-Security-Policy: sandbox allow-scripts`. Cloudflare `_headers` also
detaches the site's headers on that path (`! X-Frame-Options`, `! Content-Security-Policy`); Netlify cannot detach;
Vercel uses `source: "/_conloca/editor/:path*"`. A site-wide CSP with `frame-ancestors` must be narrowed by hand — a
second policy cannot loosen it.

## Components come from the branch's deploy

On other branches the editor offers the components of the deploy whose code is closest to the branch's latest commit:
the branch's own deploy, the default branch's, or a build of the branch it was created from (labelled in the editor), on
a tie in that order, with a warning when the components may differ from the branch's code. Doctor's CC11 warning still
says which commit is live.
