# Conloca Website

Documentation and marketing site for Conloca, built with Astro and Starlight.

## Commands

Run all commands from `private/targets/website`.

| Command                    | Action                                                 |
| -------------------------- | ------------------------------------------------------ |
| `bun run dev`              | Start the docs site locally at `http://localhost:4321` |
| `bun run build`            | Build the static site into `dist/`                     |
| `bun run preview`          | Preview the production build locally                   |
| `bun run deploy:dry`       | Validate the Worker bundle without deploying           |
| `bun run deploy`           | Deploy the website Worker and provision bindings       |
| `bun run db:migrate:local` | Apply D1 migrations to the local database              |

## Workspace Notes

- This repository uses Bun, not npm
- The docs content lives in `src/content/docs/`
- Site configuration lives in `astro.config.mjs` and `src/content.config.ts`
- Cloudflare deployment is configured in `wrangler.toml`
- The D1 binding is declared in `wrangler.toml` without a checked-in `database_id`; Wrangler can provision and link it
  on deploy
- `bun run deploy` does not apply remote D1 migrations for you; run the migration command separately before relying on
  the signup API in a fresh remote environment
- GitHub Actions injects `CLOUDFLARE_D1_DATABASE_ID` at runtime so it can apply remote D1 migrations before deploy
  without storing the UUID in git
- The deployed Worker serves static assets from `dist/` and handles `/api/subscribe`

## Related Docs

- Root workspace instructions: `private/CLAUDE.md`
- Conloca package docs: `src/content/docs/`
