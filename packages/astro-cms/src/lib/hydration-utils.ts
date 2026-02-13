import type { Config, Data } from '@puckeditor/core';
import type { HydrationStrategy } from '../types.js';
import type { HydrationMeta } from './withHydration.js';

/**
 * Extended ComponentConfig with hydration support.
 * @deprecated Use withHydration() wrapper instead of hydration property.
 */
export interface HydratableComponentConfig {
  /** @deprecated Use withHydration() wrapper on render function instead */
  hydration?: HydrationStrategy;
  render?: (props: unknown) => unknown;
}

/**
 * Component instance requiring hydration.
 * Contains the component name, props, and hydration strategy.
 */
export interface HydratableComponent {
  /** Component type name from Puck config */
  type: string;
  /** Props to pass to the component */
  props: Record<string, unknown>;
  /** Hydration strategy from ComponentConfig */
  strategy: Exclude<HydrationStrategy, 'none'>;
  /** Unique ID from Puck data (for keying) */
  id: string;
}

/**
 * Check if a component type has hydration enabled.
 *
 * First checks for __hydration metadata on the render function (new withHydration API),
 * then falls back to hydration property on ComponentConfig (deprecated).
 *
 * @param componentType - The component type name from Puck data
 * @param config - The Puck config with component definitions
 * @returns The hydration strategy ('none', 'load', 'visible', 'idle')
 */
export function isHydratable(componentType: string, config: Config): HydrationStrategy {
  const componentConfig = config.components[componentType] as HydratableComponentConfig | undefined;
  if (!componentConfig?.render) return 'none';

  // New API: Check for __hydration metadata attached by withHydration()
  const render = componentConfig.render as { __hydration?: HydrationMeta };
  if (render.__hydration?.__isHydratable) {
    return render.__hydration.strategy;
  }

  // Deprecated: Check hydration property on ComponentConfig
  return componentConfig?.hydration ?? 'none';
}

/**
 * Find all components in a Puck data tree that require hydration.
 * Walks the content array and zones recursively.
 *
 * @param data - Puck data object containing content tree
 * @param config - Puck config with component definitions
 * @returns Array of components that need hydration
 */
export function findHydratableComponents(data: Data, config: Config): HydratableComponent[] {
  const hydratable: HydratableComponent[] = [];

  // Walk content array
  if (data.content) {
    for (const item of data.content) {
      const strategy = isHydratable(item.type, config);
      if (strategy !== 'none') {
        hydratable.push({
          type: item.type,
          props: item.props ?? {},
          strategy,
          id: item.props?._id ?? item.type,
        });
      }
    }
  }

  // Walk zones (named drop zones with nested content)
  if (data.zones) {
    for (const [zoneName, zoneContent] of Object.entries(data.zones)) {
      for (const item of zoneContent) {
        const strategy = isHydratable(item.type, config);
        if (strategy !== 'none') {
          hydratable.push({
            type: item.type,
            props: item.props ?? {},
            strategy,
            id: item.props?._id ?? `${zoneName}-${item.type}`,
          });
        }
      }
    }
  }

  return hydratable;
}

/**
 * Check if Puck data contains any hydratable components.
 * Quick check before more expensive operations.
 */
export function hasHydratableComponents(data: Data, config: Config): boolean {
  // Check content
  if (data.content?.some((item) => isHydratable(item.type, config) !== 'none')) {
    return true;
  }

  // Check zones
  if (data.zones) {
    for (const zoneContent of Object.values(data.zones)) {
      if (zoneContent.some((item) => isHydratable(item.type, config) !== 'none')) {
        return true;
      }
    }
  }

  return false;
}
