/** One entry in a Puck content array: a component type plus its props. */
interface PuckItem {
  type?: string;
  props?: Record<string, unknown>;
}

/**
 * A prop whose value is Puck slot content — an array of components nested
 * inside another component (`items: Slot` and friends). Puck stores slots
 * among the ordinary props, so the shape is what identifies them: asking the
 * config which fields are slots would miss a component the config no longer
 * declares, and that is precisely the case this check exists for.
 */
function isSlotContent(value: unknown): value is PuckItem[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as PuckItem).type === 'string' &&
        typeof (entry as PuckItem).props === 'object',
    )
  );
}

/**
 * Component types present in stored content but absent from the Puck config,
 * at any nesting depth.
 *
 * Puck renders unknown types as null with no warning, so a page referencing
 * them serves HTTP 200 with an empty body and a clean console. Fragment_*
 * entries are excluded: RenderWithFragments injects those after this check.
 */
export function findUnknownComponentTypes(
  // `root` is unused here but present on every real Puck payload; declaring it
  // keeps callers from having to strip it to satisfy the type.
  data: { content?: PuckItem[]; root?: unknown } | undefined,
  config: { components?: Record<string, unknown> } | undefined,
): string[] {
  // A Set of the registered names, rather than a lookup on the config object:
  // a stored type named after an Object.prototype key ('constructor',
  // 'toString') would otherwise look registered and stay silent — the exact
  // failure this check exists to surface.
  const registered = new Set(Object.keys(config?.components ?? {}));
  const seen = new Set<string>();

  const visit = (items: PuckItem[]): void => {
    for (const item of items) {
      const type = item?.type;
      if (type && !type.startsWith('Fragment_') && !registered.has(type)) {
        seen.add(type);
      }
      for (const value of Object.values(item?.props ?? {})) {
        if (isSlotContent(value)) visit(value);
      }
    }
  };

  visit(data?.content ?? []);

  return [...seen];
}
