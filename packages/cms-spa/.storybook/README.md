# CMS component catalog

From the repository root:

```sh
bunx nx run cms-spa:build-storybook
```

The standalone site is written to `dist/storybook/cms-spa`. Serve that directory at an origin root with a static server
that supports directory indexes. The sandboxed MDX frame uses the production root-absolute URL
`/api/v1/mdx/sandbox-frame`; its HTML is emitted into the catalog, so no content API or application server is needed to
serve that frame.

`build-storybook` intentionally does not end in an application-output suffix such as `-web` or `-html`: the Smoo Nx
plugin must not fold a documentation catalog into the publishable application's aggregate `build`. The target builds its
code dependencies and the CMS stylesheet explicitly. The existing `cms-spa:test-browser` target depends on the static
build, then executes stories in Chromium.

The catalog uses the existing story files under `src/`, production CMS CSS, and an isolated browser-only Vite
configuration. It does not load application Vite configuration, environment files, or an authentication provider
globally.

This build infrastructure does not imply complete screen coverage or a StateBus migration. Existing per-story fixtures
remain as they are until their owning feature is migrated. New props-only component stories should use literal props;
StateBus screen scenarios must use an isolated composed runtime and reducer event streams, not mocked StateBus hooks or
a second component-state authority.
