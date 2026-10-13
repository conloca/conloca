import type { ComponentData, ComponentDataOptionalId, Config, Data } from '@puckeditor/core';

/**
 * Layer each block's `defaultProps` under the sparse props Puck stored, so a
 * page reads the same in the editor and on the published page. Puck saves only
 * the props an author changed and its published render applies no defaults;
 * without this, a field added to a block after a page was saved renders
 * undefined, and a select or radio field shows its first option instead of
 * the real default.
 *
 * Blocks inside a slot are merged too, top-down, and a slot the page never
 * stored is seeded from its block's defaults, so a block whose default slot
 * holds child blocks shows them before the page is first saved. A slot child
 * without an id gets one made from its parent's id, the slot name and its
 * position: stable, so every read of the same page agrees, and free of ':',
 * which Puck splits zone keys on.
 *
 * Like Puck's own slot defaults, only a block's top-level slot fields are
 * walked. The merge is shallow, so a field added inside an array item type
 * (e.g. `linkTarget` on a card list) is not backfilled into saved items —
 * renders must handle `undefined` for any array item field older content lacks.
 */
export function mergeDefaultProps(data: Data, config: Config): Data {
  if (!data?.content || !config?.components) return data;

  const mergeComponentProps = (item: ComponentData): ComponentData => {
    const componentConfig = config.components[item.type];
    if (!componentConfig) return item;

    const props = { ...componentConfig.defaultProps, ...item.props };
    for (const [slotName, field] of Object.entries(componentConfig.fields ?? {})) {
      const children: unknown = props[slotName];
      if (field.type !== 'slot' || !Array.isArray(children)) continue;

      props[slotName] = children.map((child: ComponentDataOptionalId, index) =>
        mergeComponentProps({ ...child, props: { id: `${props.id}-${slotName}-${index}`, ...child.props } }),
      );
    }

    return { ...item, props };
  };

  const mergedContent = data.content.map(mergeComponentProps);

  let mergedZones = data.zones;
  if (data.zones) {
    mergedZones = {};
    for (const [zoneKey, zoneContent] of Object.entries(data.zones)) {
      mergedZones[zoneKey] = zoneContent.map(mergeComponentProps);
    }
  }

  return {
    ...data,
    content: mergedContent,
    ...(mergedZones && { zones: mergedZones }),
  };
}
