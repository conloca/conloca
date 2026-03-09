## 0.1.14 (2026-03-09)

### 🚀 Features

- **62-01:** create publish.yml workflow with OIDC trusted publishing
  ([bcf135b](https://github.com/conloca/private/commit/bcf135b))
- **77-01:** fix sync-public workflow and subtree push scripts
  ([769de64](https://github.com/conloca/private/commit/769de64))
- **Q164:** add withManifest() promise-based mutex to AssetManifest
  ([cd929dc](https://github.com/conloca/private/commit/cd929dc))
- **Q170:** create useUploadFlow hook extracting shared upload logic
  ([97be546](https://github.com/conloca/private/commit/97be546))
- **astro-cms:** replace MIME type if/else chain with SPA_MIME_TYPES map (GL-86)
  ([ea6efdf](https://github.com/conloca/private/commit/ea6efdf))
- **ci:** add content/docs sync to public repo workflow ([08941f2](https://github.com/conloca/private/commit/08941f2))
- **cms-spa:** make page list title and path cells clickable preview links
  ([5611c20](https://github.com/conloca/private/commit/5611c20))
- **content-api:** add validateFetchUrl utility for SSRF prevention (GL-65)
  ([690cd0e](https://github.com/conloca/private/commit/690cd0e))
- **content-api-client:** add DataContext types, client method, and useDataContext hook (GL-81)
  ([ebe9e1a](https://github.com/conloca/private/commit/ebe9e1a))

### 🩹 Fixes

- **77-02:** rewrite pull-from-public workflow with correct actions and error handling
  ([2abdca4](https://github.com/conloca/private/commit/2abdca4))
- **Q153:** relax react peerDependency from exact 19.2.4 to ^19.0.0
  ([ad0d03b](https://github.com/conloca/private/commit/ad0d03b))
- **Q162:** scope git operations to contentPath directory only (GL-71)
  ([2e4a330](https://github.com/conloca/private/commit/2e4a330))
- **Q163:** convert resolveFilename from sync existsSync to async access() (GL-72)
  ([a705965](https://github.com/conloca/private/commit/a705965))
- **Q164:** batch moveAssets manifest updates via single withManifest call
  ([03f33b6](https://github.com/conloca/private/commit/03f33b6))
- **Q171:** remove dead customName code from UploadModal (GL-80)
  ([091c882](https://github.com/conloca/private/commit/091c882))
- **Q175:** CFAccessUser email/sub use undefined instead of empty string (GL-84)
  ([f1b24b4](https://github.com/conloca/private/commit/f1b24b4))
- **Q175:** guard X-CF-User-Email/Sub headers -- only set when truthy (GL-84)
  ([579a460](https://github.com/conloca/private/commit/579a460))
- **astro-cms:** escape JSON.stringify output in script tags to prevent XSS (GL-66)
  ([d060a06](https://github.com/conloca/private/commit/d060a06))
- **astro-cms:** narrow safeJsonStringify return type with overloads
  ([0701c8d](https://github.com/conloca/private/commit/0701c8d))
- **astro-cms:** add path traversal protection to handleSpa asset serving (GL-69)
  ([408634e](https://github.com/conloca/private/commit/408634e))
- **astro-cms:** remove debug console.log statements from cms-handler (GL-70)
  ([378dbeb](https://github.com/conloca/private/commit/378dbeb))
- **astro-cms:** add display:contents to HydrationWrapper div for layout transparency
  ([94c515a](https://github.com/conloca/private/commit/94c515a))
- **astro-cms:** gate error details behind import.meta.env.DEV (GL-78)
  ([4e44c4d](https://github.com/conloca/private/commit/4e44c4d))
- **astro-cms:** add assertion and DRY constant for undocumented viteReact.preambleCode API (GL-87)
  ([76a0c0e](https://github.com/conloca/private/commit/76a0c0e))
- **astro-cms:** comprehensive bun link compatibility for SSR and CMS SPA
  ([53030a5](https://github.com/conloca/private/commit/53030a5))
- **cms-spa:** reset stale dialog state on reopen (GL-90) ([f9de534](https://github.com/conloca/private/commit/f9de534))
- **content-api:** harden importFromUrl with SSRF validation, timeout, and size limit (GL-65)
  ([6bce4ce](https://github.com/conloca/private/commit/6bce4ce))
- **content-api:** fix fetch mock preconnect type errors in asset-operations tests
  ([5b98f01](https://github.com/conloca/private/commit/5b98f01))
- **content-api-client:** fix Buffer and preconnect type errors in asset-routes test
  ([13ce31f](https://github.com/conloca/private/commit/13ce31f))
- **content-api-client:** remove demo-only asset-routes test
  ([2bc8215](https://github.com/conloca/private/commit/2bc8215))
- **content-api-client:** align asset endpoint routes with server (GL-96)
  ([52c115c](https://github.com/conloca/private/commit/52c115c))
- **media:** replace bulk delete hook with direct client calls for single cache invalidation (GL-97)
  ([6bfb4fc](https://github.com/conloca/private/commit/6bfb4fc))

### 🔥 Performance

- **content-api:** cache resolveRepoRoot in createGitOperations closure (GL-83)
  ([14026e8](https://github.com/conloca/private/commit/14026e8))

### ❤️ Thank You

- Niko Tsiklauri

## 0.1.13 (2026-03-04)

### 🩹 Fixes

- **80-01:** fix private repo sync workflows token and permission bugs
  ([923c768](https://github.com/conloca/private/commit/923c768))
- **80-01:** update package.json repository fields for npm OIDC publishing
  ([3a9b92e](https://github.com/conloca/private/commit/3a9b92e))
- **Q123:** path traversal protection, debug log removal, buffer type safety
  ([b139776](https://github.com/conloca/private/commit/b139776))
- **Q123:** eliminate layer violations and fix object URL memory leak
  ([b0cba99](https://github.com/conloca/private/commit/b0cba99))
- **build:** make packages/ self-contained for subtree sync (GL-63)
  ([85592f6](https://github.com/conloca/private/commit/85592f6))
- **ci:** remove PUBLIC_REPO_TOKEN from sync-public checkout step
  ([d3c38cb](https://github.com/conloca/private/commit/d3c38cb))

### ❤️ Thank You

- Niko Tsiklauri

## 0.1.12 (2026-03-02)

### 🚀 Features

- **77-01:** fix sync-public workflow and subtree push scripts
  ([8b124b1](https://github.com/conloca/private/commit/8b124b1))
- **ci:** add content/docs sync to public repo workflow ([9697a62](https://github.com/conloca/private/commit/9697a62))

### 🩹 Fixes

- **77-02:** rewrite pull-from-public workflow with correct actions and error handling
  ([18e77ea](https://github.com/conloca/private/commit/18e77ea))
- **astro-cms:** use no-store cache header for dev-mode assets
  ([8253cfd](https://github.com/conloca/private/commit/8253cfd))
- **dashboard:** count media assets recursively in folder tree
  ([b1c0952](https://github.com/conloca/private/commit/b1c0952))
- **editor:** add cache-busting timestamp to preview URL ([a124631](https://github.com/conloca/private/commit/a124631))
- **test:** update preview URL assertion for cache-busting timestamp
  ([dc18152](https://github.com/conloca/private/commit/dc18152))

### ❤️ Thank You

- Niko Tsiklauri
