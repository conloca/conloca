/**
 * Metadata attached to components marked for hydration.
 * Used by the build-time scanner and runtime hydration system.
 */
export interface HydrationMeta {
  strategy: 'load' | 'visible' | 'idle'
  __isHydratable: true
}

/**
 * Hydration strategy for the withHydration wrapper.
 * Does not include 'none' since wrapping implies hydration is desired.
 */
export type WithHydrationStrategy = 'load' | 'visible' | 'idle'

/**
 * Marks a component's render function for client-side hydration.
 *
 * This wrapper attaches metadata to the component function, enabling:
 * 1. Build-time discovery via static analysis of source files
 * 2. Runtime hydration strategy determination
 *
 * The wrapper does NOT create a new component or add runtime overhead.
 * It simply attaches a `__hydration` property to the existing function.
 *
 * @param Component - The React component to mark for hydration
 * @param strategy - When to hydrate: 'load', 'visible', or 'idle'
 * @returns The same component with hydration metadata attached
 *
 * @example
 * ```tsx
 * // In a Puck component file (e.g., TestimonialGrid.tsx)
 * import { withHydration } from '@conloca/astro-cms'
 *
 * const TestimonialGridComponent = ({ title, testimonials }) => {
 *   const [currentPage, setCurrentPage] = useState(0)
 *   // ... interactive logic
 * }
 *
 * export const TestimonialGrid: ComponentConfig<Props> = {
 *   fields: { ... },
 *   defaultProps: { ... },
 *   render: withHydration(TestimonialGridComponent, 'visible'),
 * }
 * ```
 */
export function withHydration<T extends (props: any) => JSX.Element>(
  Component: T,
  strategy: WithHydrationStrategy
): T {
  // Environment variable escape hatch for debugging
  if (typeof process !== 'undefined' && process.env?.CONLOCA_DISABLE_HYDRATION === 'true') {
    return Component
  }

  // Attach metadata directly to the function object
  // This avoids creating a wrapper component and keeps bundle size minimal
  const HydratableComponent = Component as T & { __hydration: HydrationMeta }
  HydratableComponent.__hydration = {
    strategy,
    __isHydratable: true,
  }

  return HydratableComponent
}
