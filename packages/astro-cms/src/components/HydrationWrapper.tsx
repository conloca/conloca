import type { ReactNode } from 'react'
import type { HydrationStrategy } from '../types.js'
import { serializeProps } from '../lib/serialize-props.js'

interface HydrationWrapperProps {
  componentName: string
  strategy: HydrationStrategy
  props: Record<string, unknown>
  children: ReactNode
}

/**
 * Wraps hydratable components with data attributes for browser hydration.
 *
 * When strategy is 'none', renders children directly without wrapper overhead.
 * Otherwise, wraps in a div with data-hydrate attributes that the browser
 * hydration script uses to find and hydrate components.
 */
export function HydrationWrapper({
  componentName,
  strategy,
  props,
  children,
}: HydrationWrapperProps) {
  // No hydration needed - render children directly without wrapper
  if (strategy === 'none') {
    return <>{children}</>
  }

  // Wrap with hydration markers for the browser script to find
  return (
    <div
      data-hydrate={componentName}
      data-hydrate-strategy={strategy}
      data-props={serializeProps(props)}
    >
      {children}
    </div>
  )
}
