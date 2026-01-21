import type { Config, Data } from '@measured/puck'
import type { HydrationStrategy } from '../types.js'

/**
 * Extended ComponentConfig with hydration support.
 * Sites add `hydration` property to their ComponentConfig definitions.
 */
export interface HydratableComponentConfig {
  hydration?: HydrationStrategy
}

/**
 * Component instance requiring hydration.
 * Contains the component name, props, and hydration strategy.
 */
export interface HydratableComponent {
  /** Component type name from Puck config */
  type: string
  /** Props to pass to the component */
  props: Record<string, unknown>
  /** Hydration strategy from ComponentConfig */
  strategy: Exclude<HydrationStrategy, 'none'>
  /** Unique ID from Puck data (for keying) */
  id: string
}

/**
 * Check if a component type has hydration enabled in the config.
 */
export function isHydratable(
  componentType: string,
  config: Config
): HydrationStrategy {
  const componentConfig = config.components[componentType] as HydratableComponentConfig | undefined
  return componentConfig?.hydration ?? 'none'
}

/**
 * Find all components in a Puck data tree that require hydration.
 * Walks the content array and zones recursively.
 *
 * @param data - Puck data object containing content tree
 * @param config - Puck config with component definitions
 * @returns Array of components that need hydration
 */
export function findHydratableComponents(
  data: Data,
  config: Config
): HydratableComponent[] {
  const hydratable: HydratableComponent[] = []

  // Walk content array
  if (data.content) {
    for (const item of data.content) {
      const strategy = isHydratable(item.type, config)
      if (strategy !== 'none') {
        hydratable.push({
          type: item.type,
          props: item.props ?? {},
          strategy,
          id: item.props?._id ?? item.type,
        })
      }
    }
  }

  // Walk zones (named drop zones with nested content)
  if (data.zones) {
    for (const [zoneName, zoneContent] of Object.entries(data.zones)) {
      for (const item of zoneContent) {
        const strategy = isHydratable(item.type, config)
        if (strategy !== 'none') {
          hydratable.push({
            type: item.type,
            props: item.props ?? {},
            strategy,
            id: item.props?._id ?? `${zoneName}-${item.type}`,
          })
        }
      }
    }
  }

  return hydratable
}

/**
 * Check if Puck data contains any hydratable components.
 * Quick check before more expensive operations.
 */
export function hasHydratableComponents(data: Data, config: Config): boolean {
  // Check content
  if (data.content?.some(item => isHydratable(item.type, config) !== 'none')) {
    return true
  }

  // Check zones
  if (data.zones) {
    for (const zoneContent of Object.values(data.zones)) {
      if (zoneContent.some(item => isHydratable(item.type, config) !== 'none')) {
        return true
      }
    }
  }

  return false
}
