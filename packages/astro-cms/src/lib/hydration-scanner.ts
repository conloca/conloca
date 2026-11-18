import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import fg from 'fast-glob';

/**
 * Result of scanning a component file for withHydration usage.
 */
export interface HydrationDiscovery {
  /** Component name derived from filename (PascalCase) */
  componentName: string;
  /** Absolute path to the component file */
  filePath: string;
  /** Hydration strategy extracted from withHydration call */
  strategy: 'load' | 'visible' | 'idle';
}

// Regex to check if file imports withHydration from @conloca/astro-cms or @conloca/astro-cms/hydration
// This is faster than es-module-lexer for JSX files and avoids parse errors
export const HYDRATION_IMPORT_PATTERN =
  /import\s+\{[^}]*withHydration[^}]*\}\s+from\s+['"]@conloca\/astro-cms(?:\/hydration)?['"]/;

// Regex to find withHydration calls and extract strategy
// Matches: withHydration(ComponentName, 'strategy') or withHydration(ComponentName, "strategy")
export const HYDRATION_PATTERN = /withHydration\s*\(\s*\w+\s*,\s*['"](\w+)['"]\s*\)/g;

// Valid hydration strategies
const VALID_STRATEGIES = new Set(['load', 'visible', 'idle']);

/** A value the render module imports from a module that calls `withHydration`. */
export interface FragmentIslandDiscovery {
  /** The binding the render module imports: the island's registry key. */
  key: string;
  /** The resolved module the binding comes from. */
  filePath: string;
  /** The imported name; `'default'` for a default import. */
  exportName: string;
}

// Static import declarations with bindings: `import <clause> from '<specifier>'`, single- or multi-line.
const IMPORT_DECLARATION = /^\s*import\s+(?!type\s)([\w$\s{},]*?)\s+from\s+['"]([^'"]+)['"]/gm;

/** The value bindings of an import clause, as `[localName, exportName]`. */
function importBindings(clause: string): [string, string][] {
  const braceAt = clause.indexOf('{');
  const defaultName = (braceAt === -1 ? clause : clause.slice(0, braceAt)).replace(',', '').trim();
  const bindings: [string, string][] = defaultName ? [[defaultName, 'default']] : [];
  if (braceAt === -1) return bindings;
  for (const specifier of clause.slice(braceAt + 1, clause.indexOf('}')).split(',')) {
    const parts = specifier.trim().split(/\s+/);
    if (parts[0] === '' || parts[0] === 'type') continue;
    bindings.push([parts[2] ?? parts[0], parts[0]]);
  }
  return bindings;
}

/**
 * Finds the hydrated fragment components the render module imports: every value binding imported from a module
 * that imports `withHydration`, in import order. Type-only, namespace and side-effect-only imports never match.
 *
 * @param renderModulePath - Absolute path of the site's render module
 * @param resolveImport - Resolves a specifier from an importer (Vite's `this.resolve` in the plugin); an externalized
 *   result is a package the build never bundles, so it is skipped unread
 */
export async function discoverFragmentIslands(
  renderModulePath: string,
  resolveImport: (
    specifier: string,
    importer: string,
  ) => Promise<{ id: string; external?: boolean | 'absolute' | 'relative' } | null | undefined>,
): Promise<FragmentIslandDiscovery[]> {
  const source = await readFile(renderModulePath, 'utf-8');
  const declarations = [...source.matchAll(IMPORT_DECLARATION)].map(([, clause, specifier]) => ({
    bindings: importBindings(clause),
    specifier,
  }));
  const perDeclaration = await Promise.all(
    declarations.map(async ({ bindings, specifier }): Promise<FragmentIslandDiscovery[]> => {
      if (bindings.length === 0) return [];
      const resolved = await resolveImport(specifier, renderModulePath);
      if (!resolved || resolved.external || resolved.id.startsWith('\0')) return [];
      const filePath = resolved.id;
      try {
        if (!HYDRATION_IMPORT_PATTERN.test(await readFile(filePath, 'utf-8'))) return [];
      } catch (err) {
        console.warn(`[Conloca Hydration] Error reading ${filePath}:`, err);
        return [];
      }
      return bindings.map(([key, exportName]) => ({ key, filePath, exportName }));
    }),
  );
  return perDeclaration.flat();
}

/**
 * Derives component scan paths from puckConfigPath.
 *
 * Convention: puckConfigPath directory + '/components/puck'
 * Example: './src/puck.config.tsx' -> './src/components/puck'
 *
 * If explicitPaths provided, they extend (not replace) the auto-discovered path.
 *
 * @param puckConfigPath - Path to the puck config (e.g., './src/puck.config.tsx')
 * @param explicitPaths - Optional additional paths to scan
 * @returns Array of paths to scan for hydratable components
 */
export function deriveComponentPaths(puckConfigPath: string, explicitPaths?: string[]): string[] {
  const puckDir = dirname(puckConfigPath);
  const defaultScanPath = join(puckDir, 'components', 'puck');

  if (explicitPaths && explicitPaths.length > 0) {
    return [defaultScanPath, ...explicitPaths];
  }
  return [defaultScanPath];
}

/**
 * Derives a PascalCase component name from a file path.
 *
 * @param filePath - Absolute path to the component file
 * @returns Component name in PascalCase
 *
 * @example
 * deriveComponentName('/src/components/puck/TestimonialGrid.tsx')
 * // => 'TestimonialGrid'
 *
 * deriveComponentName('/src/components/puck/blog-post-grid.tsx')
 * // => 'BlogPostGrid'
 */
function deriveComponentName(filePath: string): string {
  const filename = basename(filePath, extname(filePath));
  // Convert kebab-case to PascalCase if needed
  if (filename.includes('-')) {
    return filename
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }
  // Ensure first letter is uppercase
  return filename.charAt(0).toUpperCase() + filename.slice(1);
}

/**
 * Scans component directories for files using withHydration wrapper.
 *
 * This function performs static analysis to discover components marked
 * for hydration, without executing any component code.
 *
 * @param componentPaths - Relative paths to scan (e.g., ['src/components/puck'])
 * @param projectRoot - Absolute path to the project root
 * @returns Array of discovered hydratable components with their strategies
 *
 * @example
 * ```typescript
 * const discoveries = await scanForHydratableComponents(
 *   ['src/components/puck'],
 *   '/path/to/project'
 * )
 * // => [{ componentName: 'TestimonialGrid', filePath: '...', strategy: 'visible' }]
 * ```
 */
export async function scanForHydratableComponents(
  componentPaths: string[],
  projectRoot: string,
): Promise<HydrationDiscovery[]> {
  const discoveries: HydrationDiscovery[] = [];
  const seenNames = new Map<string, string>(); // componentName -> first filePath

  for (const scanPath of componentPaths) {
    const absolutePath = resolve(projectRoot, scanPath);

    // Find all .tsx files in the directory and subdirectories
    const files = await fg('**/*.tsx', {
      cwd: absolutePath,
      absolute: true,
      onlyFiles: true,
    });

    for (const filePath of files) {
      try {
        const content = await readFile(filePath, 'utf-8');

        // Fast path: check if file imports withHydration from @conloca/astro-cms
        // Using simple regex instead of es-module-lexer to avoid JSX parse errors
        if (!HYDRATION_IMPORT_PATTERN.test(content)) {
          continue;
        }

        // Find withHydration calls with regex
        const matches = [...content.matchAll(HYDRATION_PATTERN)];

        if (matches.length === 0) {
          continue;
        }

        if (matches.length > 1) {
          console.warn(
            `[Conloca Hydration] Multiple withHydration calls in ${filePath}. ` +
              'Consider splitting into separate component files. Using first call.',
          );
        }

        const match = matches[0];
        const rawStrategy = match[1];

        // Validate strategy
        if (!VALID_STRATEGIES.has(rawStrategy)) {
          console.warn(
            `[Conloca Hydration] Invalid strategy '${rawStrategy}' in ${filePath}. ` +
              `Valid options: ${[...VALID_STRATEGIES].join(', ')}. Skipping component.`,
          );
          continue;
        }

        const strategy = rawStrategy as 'load' | 'visible' | 'idle';
        const componentName = deriveComponentName(filePath);

        // Check for naming conflicts
        const existingPath = seenNames.get(componentName);
        if (existingPath) {
          console.warn(
            `[Conloca Hydration] Duplicate component name '${componentName}'. ` +
              `Found in: ${existingPath} and ${filePath}. Using first occurrence.`,
          );
          continue;
        }

        seenNames.set(componentName, filePath);
        discoveries.push({
          componentName,
          filePath,
          strategy,
        });
      } catch (err) {
        // Log error but continue scanning other files
        console.warn(`[Conloca Hydration] Error reading ${filePath}:`, err);
      }
    }
  }

  return discoveries;
}
