# Conloca Website

Documentation and marketing site for Conloca, built with Astro and Starlight.

## Commands

Run all commands from `private/targets/website`.

| Command           | Action                                                 |
| ----------------- | ------------------------------------------------------ |
| `bun run dev`     | Start the docs site locally at `http://localhost:4321` |
| `bun run build`   | Build the static site into `dist/`                     |
| `bun run preview` | Preview the production build locally                   |

## Workspace Notes

- This repository uses Bun, not npm
- The docs content lives in `src/content/docs/`
- Site configuration lives in `astro.config.mjs` and `src/content.config.ts`

## Related Docs

- Root workspace instructions: `private/CLAUDE.md`
- Conloca package docs: `src/content/docs/`
