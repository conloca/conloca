import { Render } from '@measured/puck'
import type { Config, Data } from '@measured/puck'
import { HydrationWrapper } from './HydrationWrapper.js'
import { isHydratable } from '../lib/hydration-utils.js'

interface RenderWithHydrationProps {
  config: Config
  data: Data
}

/**
 * Wrapper around Puck's Render component that adds hydration support.
 *
 * For each component with a hydration strategy configured, wraps the
 * component's render output with HydrationWrapper to add data-hydrate
 * attributes for browser-side hydration.
 *
 * Non-hydratable components render without any wrapper overhead.
 */
export function RenderWithHydration({ config, data }: RenderWithHydrationProps) {
  // Create wrapped config with hydration-aware render functions
  const wrappedConfig: Config = {
    ...config,
    components: Object.fromEntries(
      Object.entries(config.components).map(([name, componentConfig]) => {
        const strategy = isHydratable(name, config)

        if (strategy === 'none') {
          // No wrapping needed - component stays static
          return [name, componentConfig]
        }

        // Wrap the render function so its output becomes HydrationWrapper children
        const originalRender = componentConfig.render
        return [
          name,
          {
            ...componentConfig,
            render: (props: Record<string, unknown>) => (
              <HydrationWrapper
                componentName={name}
                strategy={strategy}
                props={props}
              >
                {originalRender(props)}
              </HydrationWrapper>
            ),
          },
        ]
      })
    ),
  }

  return <Render config={wrappedConfig} data={data} />
}
