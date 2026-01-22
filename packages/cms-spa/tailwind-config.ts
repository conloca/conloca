import { $ } from 'bun';

/**
 * Shared configuration for Tailwind CSS processing
 */
export const TAILWIND_CONFIG = {
  input: './src/main.css',
  outputCompiled: './src/main.compiled.css',
  outputProcessed: './src/main.processed.css',
  // Use the installed @tailwindcss/cli from devDependencies
  cli: './node_modules/.bin/tailwindcss',
} as const;

/**
 * Process CSS with Tailwind CLI
 * @param options - Build options
 */
export async function processTailwindCSS(options: {
  input?: string;
  output: string;
  watch?: boolean;
  minify?: boolean;
}) {
  const args = [TAILWIND_CONFIG.cli, '-i', options.input || TAILWIND_CONFIG.input, '-o', options.output];

  if (options.watch) {
    args.push('--watch=always');
  }

  if (options.minify) {
    args.push('--minify');
  }

  // Use bun to run the CLI
  return $`bun ${args}`;
}
