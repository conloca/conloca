---
name: conloca-cloud
description: Load when a Conloca site uses @conloca/cloud-astro — editor endpoint, build token, registrations, preview.
---

# Connecting a site to an editor endpoint

`conlocaCloud(...)` from `@conloca/cloud-astro` is an add-on to `conlocaCMS(...)` — keep both in `integrations`. It
hooks the site's `astro build` to compile the Puck config into an editor bundle, register that build at `endpoint`, and
produce a draft-preview app. Nothing from it runs on the published site.

## First move: `conloca doctor --live`

For any question about the editor at `endpoint` — editor not loading, a stale editor after a deploy, "is this branch
registered?" — run this before reading source:

```bash
CONLOCA_BUILD_TOKEN=cbt_... conloca doctor --live     # add CONLOCA_ENDPOINT=https://... when the config computes endpoint
conloca doctor                                        # offline: config, token, endpoint, inert options
```

This package's checks are `CC1`–`CC7`. Offline: the wiring, the build token, the endpoint and public base URL, and
`conlocaCMS` options the endpoint's editor ignores. With `--live` (the token goes only to the configured endpoint): the
endpoint answers the token, a registration serves this branch and site, and the editor bundle that registration names is
still deployed.

## The one secret: the build token

`CONLOCA_BUILD_TOKEN=cbt_<id>.<secret>` is issued by the endpoint and set as a CI secret. It authenticates the build —
no other setup, no OIDC. Repository identity comes from CI metadata (`GITHUB_REPOSITORY`, Vercel, GitLab) or the git
remote; `repoUri` is only for non-standard checkouts. The `endpoint` is an https URL with no trailing slash.

**Whole-line gotcha:** the endpoint shows and copies the token as the line `CONLOCA_BUILD_TOKEN=cbt_…`. Pasted whole
into a secret's value, doctor CC2 reports it and the build's registration answers `401`; the token is fine — store only
the part from `cbt_`.

**Rotation gotcha:** creating a new token invalidates the old one. A `401` from the endpoint for a value that does start
with `cbt_` (doctor CC5) means the CI secret still holds a rotated token — create a new one and update the secret.

## The pipeline: build → register → editor

1. `astro build` with the token compiles `dist/_conloca/editor-bundle.<hash>.js` and POSTs a registration naming the
   repo, git sha, branch, site id, and the bundle URL + hash.
2. The editor at `endpoint`, opened on a branch, loads the NEWEST registration for `(branch, site)`.
3. A build without a prerequisite (token, repo identity, sha/branch, public base URL) does not register; it warns and
   ends with a summary block. Set `requireRegistration: true` in CI to fail such builds. A registration the endpoint
   REJECTS always fails the build.

## Three states of a branch (doctor CC6)

- **Own registration** — the branch was built with the token; the editor loads its bundle.
- **Inherited** — no registration for this branch, but the default branch has one: the editor works from that bundle and
  draft preview is degraded. Build the branch with the token to register it.
- **None** — neither: the editor will not load for this branch. Build it with the token.

Doctor may also report older registrations that are not active yet. They become active the next time the editor opens,
so a branch served only by them is a warning rather than "will not load" — it fails only if that branch has since grown
a second site.

## A deleted bundle (CC7)

A registration can outlive its bytes: a later deploy from another branch replaces `dist/`, and the registration still
points at a bundle URL that now 404s. Nothing else notices — the editor just fails to load. `conloca doctor --live`
probes the bundle URL the registration names and says so: rebuild and deploy from that branch.

## Options with no effect on the endpoint's editor

`conlocaCMS`'s `editorStyles` and `editorCSS` configure the local dev editor only. `templates`, `schemasPath`, and
`mdxComponentFolders` reach the endpoint's editor automatically.
