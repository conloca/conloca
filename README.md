# Conloca CMS

A modern, flexible content management system built with React, TypeScript, and Astro.

## Packages

This repository contains the private packages from the Conloca monorepo:

- `@conloca/content-api` - Core content operations and component registry
- `@conloca/content-api-client` - React Query client for the content API
- `@conloca/mdx-editor` - MDX editor component with rich text features
- `@conloca/astro-cms` - Astro integration for Conloca CMS
- `@conloca/cms-spa` - Single Page Application for CMS interface

## Installation

```bash
npm install @conloca/astro-cms
```

## Development

Run validation in this checkout's devenv shell:

```bash
tooling/devenv shell -- bun nx run-many -t lint test build
```

The shell builds the pinned native TypeScript compiler and exports
`SMOO_TYPECHECK_TSC` for the typecheck targets. A missing export means the
environment setup must be updated; installing another npm compiler does not fix it.

## Documentation

Coming soon.

## License

This software is licensed under the
[Functional Source License, Version 1.1, Apache 2.0 Future License (FSL-1.1-ALv2)](https://fsl.software/FSL-1.1-ALv2.template.md).

See [LICENSE](./LICENSE) for the full license text.
