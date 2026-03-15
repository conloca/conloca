# Conloca Website

Documentation and marketing site for Conloca, built with Astro and Starlight.

## Commands

Run all commands from `private/targets/website`.

| Command                    | Action                                                 |
| -------------------------- | ------------------------------------------------------ |
| `bun run dev`              | Start the docs site locally at `http://localhost:4321` |
| `bun run build`            | Build the static site into `dist/`                     |
| `bun run preview`          | Preview the production build locally                   |
| `bun run deploy:dry`       | Validate the unified website Worker deployment         |
| `bun run deploy`           | Deploy the unified website Worker                      |
| `bun run db:migrate:local` | Apply D1 migrations to the local database              |
| `bun run db:migrate:prod`  | Apply D1 migrations to the remote D1 database          |

## Workspace Notes

- This repository uses Bun, not npm
- The docs content lives in `src/content/docs/`
- Site configuration lives in `astro.config.mjs` and `src/content.config.ts`
- Cloudflare deployment is configured in `wrangler.toml`
- The D1 database is provisioned via Wrangler using `binding = "DB"` and `database_name = "conloca-website-db"` without
  checked-in IDs
- Remote D1 migrations use `scripts/apply-remote-d1-migrations.ts` to resolve the database UUID at runtime and keep IDs
  out of git
- The deployed Worker serves static assets from `dist/` and handles `/api/subscribe`

## Related Docs

- Root workspace instructions: `private/CLAUDE.md`
- Conloca package docs: `src/content/docs/`
