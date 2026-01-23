import { readFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import fg from 'fast-glob'

/**
 * Result of scanning a component file for withHydration usage.
 */
export interface HydrationDiscovery {
  /** Component name derived from filename (PascalCase) */
  componentName: string
  /** Absolute path to the component file */
  filePath: string
  /** Hydration strategy extracted from withHydration call */
  strategy: 'load' | 'visible' | 'idle'
}

// Regex to check if file imports withHydration from @conloca/astro-cms or @conloca/astro-cms/hydration
// This is faster than es-module-lexer for JSX files and avoids parse errors
const HYDRATION_IMPORT_PATTERN = /import\s+\{[^}]*withHydration[^}]*\}\s+from\s+['"]@conloca\/astro-cms(?:\/hydration)?['"]/

// Regex to find withHydration calls and extract strategy
// Matches: withHydration(ComponentName, 'strategy') or withHydration(ComponentName, "strategy")
const HYDRATION_PATTERN = /withHydration\s*\(\s*\w+\s*,\s*['"](\w+)['"]\s*\)/g

// Valid hydration strategies
const VALID_STRATEGIES = new Set(['load', 'visible', 'idle'])

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
  const filename = basename(filePath, extname(filePath))
  // Convert kebab-case to PascalCase if needed
  if (filename.includes('-')) {
    return filename
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('')
  }
  // Ensure first letter is uppercase
  return filename.charAt(0).toUpperCase() + filename.slice(1)
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
  projectRoot: string
): Promise<HydrationDiscovery[]> {
  const discoveries: HydrationDiscovery[] = []
  const seenNames = new Map<string, string>() // componentName -> first filePath

  for (const scanPath of componentPaths) {
    const absolutePath = resolve(projectRoot, scanPath)

    // Find all .tsx files in the directory and subdirectories
    const files = await fg('**/*.tsx', {
      cwd: absolutePath,
      absolute: true,
      onlyFiles: true,
    })

    for (const filePath of files) {
      try {
        const content = await readFile(filePath, 'utf-8')

        // Fast path: check if file imports withHydration from @conloca/astro-cms
        // Using simple regex instead of es-module-lexer to avoid JSX parse errors
        if (!HYDRATION_IMPORT_PATTERN.test(content)) {
          continue
        }

        // Find withHydration calls with regex
        const matches = [...content.matchAll(HYDRATION_PATTERN)]

        if (matches.length === 0) {
          continue
        }

        if (matches.length > 1) {
          console.warn(
            `[Conloca Hydration] Multiple withHydration calls in ${filePath}. ` +
              'Consider splitting into separate component files. Using first call.'
          )
        }

        const match = matches[0]
        const rawStrategy = match[1]

        // Validate strategy
        if (!VALID_STRATEGIES.has(rawStrategy)) {
          console.warn(
            `[Conloca Hydration] Invalid strategy '${rawStrategy}' in ${filePath}. ` +
              `Valid options: ${[...VALID_STRATEGIES].join(', ')}. Skipping component.`
          )
          continue
        }

        const strategy = rawStrategy as 'load' | 'visible' | 'idle'
        const componentName = deriveComponentName(filePath)

        // Check for naming conflicts
        const existingPath = seenNames.get(componentName)
        if (existingPath) {
          console.warn(
            `[Conloca Hydration] Duplicate component name '${componentName}'. ` +
              `Found in: ${existingPath} and ${filePath}. Using first occurrence.`
          )
          continue
        }

        seenNames.set(componentName, filePath)
        discoveries.push({
          componentName,
          filePath,
          strategy,
        })
      } catch (err) {
        // Log error but continue scanning other files
        console.warn(`[Conloca Hydration] Error reading ${filePath}:`, err)
      }
    }
  }

  return discoveries
}
