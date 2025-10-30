# @conloca/cli

Command-line interface for Conloca content management.

## Installation

```bash
npm install -g @conloca/cli
# or
bun add -g @conloca/cli
```

## Usage

### Initialize Content Structure

Initialize a new Conloca content structure for a site:

```bash
conloca init <directory> <site>
```

This command will:

- Create the content directory structure
- Create directories for the specified site
- Create or update the sites.json configuration file
- Set up the blocks/shared directory for shared components

Example:

```bash
conloca init ./my-project mysite
```

### Verify Content

Verify content files in a directory, automatically repairing any files missing required fields:

```bash
conloca verify <directory>
```

This command will:

- Check all content files in the specified directory
- Automatically repair files missing required fields (id, created, modified)
- Report any errors found
- Display a summary of verified content items

### Astro Integration

Generate Astro route files for rendering CMS pages:

```bash
conloca astro generate-routes [path]
```

This command will:

- Create `src/pages/[...slug].astro` dynamic route file
- Create `src/puck.config.tsx` with basic component definitions (if it doesn't exist)
- Set up the basic structure for rendering Puck pages

Options:

- `-s, --site <name>`: Target a specific site (default: `default`). If not provided, the generated route can still be overridden at runtime via the `SITE_NAME` or `PUBLIC_SITE_NAME` env var.

Examples:

```bash
# Generate in current directory
conloca astro generate-routes

# Generate in a specific project
conloca astro generate-routes ./my-astro-project

# Generate for a specific site (e.g., "blog")
conloca astro generate-routes ./my-astro-project --site blog
```

Programmatic usage (pass a site name):

```ts
import { generateRoutes } from '@conloca/cli/commands/generate-routes';

// Generate routes for the "blog" site in the current directory
await generateRoutes('.', 'blog');
```

After generation, you can:
1. Customize the `[...slug].astro` file to add your own layout
2. Add more component types to `puck.config.tsx`
3. Start your dev server and visit `/__cms` to edit pages

Note on multi-site:

- The generated `[...slug].astro` reads content from the Content API for a given site. By default it uses `default`. You can change the site at runtime by setting an environment variable (e.g. `SITE_NAME=blog`) and restarting the dev server.

## Development

### Building

```bash
bun run build
```

### Testing

```bash
bun test
```

The CLI is bundled into a single executable file using Bun's build system.
