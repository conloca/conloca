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
