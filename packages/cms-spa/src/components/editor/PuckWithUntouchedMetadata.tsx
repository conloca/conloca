import { type ComponentConfig, type Config, type Metadata, Puck } from '@puckeditor/core';
import { type ComponentProps, createContext, type ReactElement, useContext, useMemo } from 'react';

/**
 * Works around Puck bugs https://github.com/puckeditor/puck/issues/1326 and
 * https://github.com/puckeditor/puck/issues/1560 (open in 0.23.0 and the 0.24 canary; no fix in progress).
 *
 * On the editor canvas Puck runs each block's whole `puck` prop, `puck.metadata` included, through the walk
 * that turns the block's fields into in-place editors. The walk rebuilds every object it meets as a plain
 * object, so a Date, Map or class instance arrives as `{}`, and it applies the block's field transforms to any
 * metadata key named like one of the block's fields, at any depth: under a block with an inline-editable
 * `title` field, `page.title` arrives as Puck's inline text editor. resolveData and the published `<Render>`
 * get the metadata as it was given.
 *
 * So the page editor gives each block's render the metadata `<Puck>` was given, through a React context the
 * walk never sees, merged with the block's own `metadata` the way Puck merges them. The rest of `puck`, and
 * every other prop (inline-editable fields, rich text, slots, and props a block's resolveData copied out of
 * the metadata), stays exactly as Puck built it. So a block should read page data from `puck.metadata` in
 * render, not from props its resolveData copied out of it.
 *
 * When a canary story in PuckWithUntouchedMetadata.stories.tsx fails, render bare `<Puck>` in PageEditor and
 * run that file's stories that go through PageEditor. Delete this module only if they pass; otherwise keep it
 * and update the canary that failed.
 */

const NO_METADATA: Metadata = {};

const UntouchedMetadata = createContext<Metadata>(NO_METADATA);

/** One wrapper per block config, so a block keeps its render identity (and stays mounted) while its config does. */
const untouchedBlocks = new WeakMap<ComponentConfig, ComponentConfig>();

/** The block with `puck.metadata` set from the context: the metadata `<Puck>` was given, then the block's own. */
function withUntouchedMetadata(block: ComponentConfig): ComponentConfig {
  const known = untouchedBlocks.get(block);
  if (known) return known;
  // Rendered, never called: a site may ship its block as memo(...) or forwardRef(...).
  const Block = block.render;
  const render: ComponentConfig['render'] = (props) => {
    const metadata = useContext(UntouchedMetadata);
    return <Block {...props} puck={{ ...props.puck, metadata: { ...metadata, ...block.metadata } }} />;
  };
  const untouched = { ...block, render };
  untouchedBlocks.set(block, untouched);
  return untouched;
}

/** Puck's editor, with every block's render given `puck.metadata` exactly as resolveData and the published page get it. */
export function PuckWithUntouchedMetadata(props: ComponentProps<typeof Puck>): ReactElement {
  const { config, metadata } = props;
  const canvasConfig = useMemo<Config>(
    () => ({
      ...config,
      components: Object.fromEntries(
        Object.entries(config.components).map(([name, block]) => [name, withUntouchedMetadata(block)]),
      ),
    }),
    [config],
  );
  return (
    <UntouchedMetadata.Provider value={metadata ?? NO_METADATA}>
      <Puck {...props} config={canvasConfig} />
    </UntouchedMetadata.Provider>
  );
}
