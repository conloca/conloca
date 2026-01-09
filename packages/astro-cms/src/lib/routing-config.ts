import type { RouteConfig, RoutingConfig, RoutingConfigInput } from '../types.js';

/**
 * Normalize routing config input to full RoutingConfig.
 *
 * Handles the `routing: true` shorthand and boolean values.
 *
 * @param input - The routing config input (boolean, object, or undefined)
 * @returns Normalized RoutingConfig or undefined if not enabled
 */
export function normalizeRoutingConfig(
  input: RoutingConfigInput | undefined,
): RoutingConfig | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (input === true) {
    return {
      enabled: true,
      routes: {
        pages: {
          pattern: '/[...slug]',
          collection: 'pages',
          prerender: true,
        },
      },
      fallback: '404',
      onConflict: 'warn',
    };
  }

  if (input === false) {
    return { enabled: false };
  }

  return input;
}

/**
 * Apply defaults to a RouteConfig.
 *
 * Fills in missing optional fields with their default values.
 *
 * @param config - Partial route configuration
 * @returns Complete route configuration with all fields
 */
export function resolveRouteConfig(config: RouteConfig): Required<RouteConfig> {
  return {
    pattern: config.pattern,
    collection: config.collection ?? 'pages',
    layout: config.layout ?? '',
    prerender: config.prerender ?? true,
    meta: config.meta ?? {},
  };
}

/**
 * Validate a route pattern.
 *
 * Ensures the pattern is a valid Astro route pattern.
 * Throws descriptive error if invalid.
 *
 * @param pattern - The route pattern to validate
 * @param routeName - Name of the route (for error messages)
 * @throws Error if pattern is invalid
 */
export function validateRoutePattern(pattern: string, routeName: string): void {
  if (!pattern.startsWith('/')) {
    throw new Error(`Route '${routeName}': pattern must start with '/', got '${pattern}'`);
  }

  // Check for valid Astro route syntax
  // Allow: a-zA-Z0-9, hyphen, underscore, slash, brackets, dots
  const invalidChars = pattern.match(/[^a-zA-Z0-9\-_/[\].]/g);
  if (invalidChars) {
    throw new Error(
      `Route '${routeName}': pattern contains invalid characters: ${invalidChars.join(', ')}`,
    );
  }

  // Check for balanced brackets
  const openBrackets = (pattern.match(/\[/g) || []).length;
  const closeBrackets = (pattern.match(/\]/g) || []).length;
  if (openBrackets !== closeBrackets) {
    throw new Error(`Route '${routeName}': pattern has unbalanced brackets: '${pattern}'`);
  }
}
