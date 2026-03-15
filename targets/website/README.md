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

## Workspace Notes

- This repository uses Bun, not npm
- The docs content lives in `src/content/docs/`
- Site configuration lives in `astro.config.mjs` and `src/content.config.ts`
- Cloudflare deployment is configured in `wrangler.toml`
- The D1 database is provisioned via Wrangler using `binding = "DB"` and `database_name = "conloca-website-db"` without
  checked-in IDs
- GitHub Actions injects `CLOUDFLARE_D1_DATABASE_ID` at runtime for remote D1 migrations, so the UUID stays out of git
- The deployed Worker serves static assets from `dist/` and handles `/api/subscribe`

## Related Docs

- Root workspace instructions: `private/CLAUDE.md`
- Conloca package docs: `src/content/docs/`
