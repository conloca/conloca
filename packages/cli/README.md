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
conloca init . default
```

### Astro Integration

Set up Astro integration with all necessary files:

```bash
conloca astro setup [path]
```

This command will generate:

- `src/pages/[...slug].astro` - Dynamic route file for CMS pages
- `src/content.config.ts` - Astro content collections config
- `src/puck.config.tsx` - Puck component configuration
- `src/components/Layout.tsx` - Layout HOC with grid/flex support
- `src/components/Section.tsx` - Section wrapper component
- `src/components/puck/Heading.tsx` - Heading component
- `src/components/puck/Text.tsx` - Text component
- `src/components/puck/Flex.tsx` - Flex layout component
- `src/components/puck/Grid.tsx` - Grid layout component
- `src/schemas/data.ts` - Example Zod schemas for data collections

Options:

- `-s, --site <name>`: Target a specific site (default: `default`)

Examples:

```bash
# Set up in current directory
conloca astro setup

# Set up in a specific project
conloca astro setup ./my-astro-project

# Set up for a specific site
conloca astro setup ./my-astro-project --site blog
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

## Quick Start

```bash
# 1. Create a new Astro project (if you don't have one)
npm create astro@latest my-site
cd my-site

# 2. Install Conloca packages
npm install @conloca/astro-cms @conloca/content-api @conloca/mdx @measured/puck

# 3. Initialize content structure
conloca init . default

# 4. Set up Astro integration
conloca astro setup

# 5. Start your dev server
npm run dev

# 6. Visit /__cms to edit pages
```

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
