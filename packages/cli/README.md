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
