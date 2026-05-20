import type { MdxComponentProp, MdxJsxComponentDescriptor } from '@conloca/cms-spa/mdx-components';
import type { LocalComponentScanResult, ParsedProp } from './scan-components';
import type { MdxImport, MdxScanResult } from './scan-mdx';
import type { CmsOverride } from './scan-overrides';

/**
 * Combine the MDX usage scan with the local-component folder scan
 * into the final flat list of component descriptors the editor
 * registry consumes.
 *
 * Rules (chosen to match the decisions locked in earlier this
 * session — usage-only inference for npm, full interface schema
 * for local, per-file context wins on name collisions, aliases
 * preserved per file):
 *
 *   1. Every component referenced by an `import` in any MDX file
 *      becomes a descriptor. The `name` is the canonical export
 *      name (`Aside`, not `Callout`), the `source` is the import
 *      path. This catches npm packages we can't statically scan.
 *
 *   2. Every component found by the local folder scan is also a
 *      descriptor. Its props come from the parsed `Props` interface.
 *      If the same canonical (name, source) was also seen in MDX,
 *      we merge — interface props win on the schema, usage-observed
 *      string values enrich `options`.
 *
 *   3. Components seen in MDX but never declared in any import
 *      (raw HTML tags like `<div>` or unresolved names) are dropped —
 *      `GenericBlock` already has its own HTML-passthrough path.
 *
 *   4. Across all usages, observed string values per attribute are
 *      collected. When ≤5 distinct values are seen (and the prop
 *      doesn't already have explicit options from the interface),
 *      they're added as dropdown choices.
 *
 *   5. Aliases (file-local imports renaming the canonical export,
 *      eg `import { Aside as Callout }`) are tracked on the
 *      descriptor's `aliases` map keyed by file path. The save
 *      serializer reads this to preserve the alias when writing
 *      the file back out.
 *
 *   6. Name collisions across different sources (local `<Card>` vs
 *      Starlight `<Card>`) — for MVP, the local source wins. Both
 *      remain available; the editor's insert flow will need to
 *      disambiguate by current-file context (TODO when the insert
 *      menu lands).
 */

/** Same shape as `MdxJsxComponentDescriptor` from cms-spa, extended
 * with `aliases` so save serialization can preserve `import { X as Y }`
 * per file. Cms-spa's runtime type doesn't need to know about
 * aliases — they're picked up server-side at save time. */
export interface DiscoveredComponent extends MdxJsxComponentDescriptor {
  /** Per-file local alias (when the file uses `import { X as Y }`).
   * Map key is the absolute MDX file path. */
  aliases?: Record<string, string>;
}

export function mergeRegistry(
  mdxScans: MdxScanResult[],
  localComponents: LocalComponentScanResult[],
  overrides?: Map<string, CmsOverride>,
): DiscoveredComponent[] {
  // Key descriptors by `${source}::${exportName}` so we can merge
  // local-folder data with MDX-usage data and so two components
  // with the same name but different sources stay separate.
  const byKey = new Map<string, DescriptorBuilder>();

  // Pass 1: seed from local folder scan.
  for (const comp of localComponents) {
    const key = `${comp.source}::${comp.name}`;
    byKey.set(
      key,
      new DescriptorBuilder({
        name: comp.name,
        source: comp.source,
        defaultExport: false,
        kind: comp.kind,
        propsFromInterface: comp.props,
      }),
    );
  }

  // Pass 2: seed/enrich from MDX usage scans.
  for (const scan of mdxScans) {
    for (const usage of scan.usages) {
      const imp = scan.imports[usage.name];
      if (!imp) continue; // raw HTML tag or unresolved — skip.
      const canonicalName = imp.exportName === 'default' ? usage.name : imp.exportName;
      const key = `${imp.source}::${canonicalName}`;

      let builder = byKey.get(key);
      if (!builder) {
        builder = new DescriptorBuilder({
          name: canonicalName,
          source: imp.source,
          defaultExport: imp.defaultExport,
          kind: usage.kind,
        });
        byKey.set(key, builder);
      }
      builder.observeUsage(usage.attrs, scan.filepath, usage.name, imp, usage.kind);
    }
  }

  // Resolve name collisions: when two (source, name) pairs share a
  // `name`, the editor registry can only key one descriptor by that
  // name. Pick the source that has the most MDX usage; the dropped
  // alternative isn't lost forever — it just doesn't surface in the
  // registry until the disambiguation UI exists.
  const grouped = new Map<string, DescriptorBuilder[]>();
  for (const builder of byKey.values()) {
    const arr = grouped.get(builder.getName()) ?? [];
    arr.push(builder);
    grouped.set(builder.getName(), arr);
  }
  const winners: DiscoveredComponent[] = [];
  for (const candidates of grouped.values()) {
    candidates.sort((a, b) => {
      // Higher actual MDX usage wins.
      if (a.getUsageCount() !== b.getUsageCount()) return b.getUsageCount() - a.getUsageCount();
      // Tie: prefer the one with an interface-derived schema (more
      // likely to be the right one).
      const aHasSchema = a.hasInterfaceSchema();
      const bHasSchema = b.hasInterfaceSchema();
      if (aHasSchema !== bHasSchema) return aHasSchema ? -1 : 1;
      return 0;
    });
    let descriptor = candidates[0].toDescriptor();
    const override = overrides?.get(descriptor.name);
    if (override) descriptor = applyOverride(descriptor, override);
    winners.push(descriptor);
  }
  return winners;
}

/**
 * Apply a host-provided override to an auto-discovered descriptor.
 *
 * Three kinds of merges happen:
 *
 *   1. **Shallow object merges** for `insert` and `defaults` — host
 *      fields overwrite inferred fields one key at a time, so a host
 *      can tweak only the label without losing the inferred category.
 *
 *   2. **Per-prop merges** for the `props` array — match by `name`,
 *      override individual fields (`required`, `label`, `help`,
 *      `options`) while keeping the rest of the prop's inferred
 *      schema (type, defaultValue). Props the override doesn't mention
 *      stay untouched.
 *
 *   3. **Scalar overrides** for `hasChildren` and `kind` — host value
 *      replaces inferred value directly.
 *
 * The override is INTENTIONALLY a subset of `MdxJsxComponentDescriptor`
 * — fields the host can sensibly customize. Things like `name` and
 * `import` come from the actual file system / MDX scan and can't be
 * meaningfully overridden by a sidecar JSON.
 */
function applyOverride(descriptor: DiscoveredComponent, override: CmsOverride): DiscoveredComponent {
  const next: DiscoveredComponent = { ...descriptor };

  if (override.insert) {
    next.insert = { ...(descriptor.insert ?? { label: descriptor.name }), ...override.insert };
  }
  if (override.defaults) {
    next.defaults = {
      ...(descriptor.defaults ?? {}),
      ...override.defaults,
      ...(override.defaults.attributes
        ? { attributes: { ...(descriptor.defaults?.attributes ?? {}), ...override.defaults.attributes } }
        : {}),
    };
  }
  if (override.hasChildren !== undefined) {
    next.hasChildren = override.hasChildren;
  }
  if (override.kind) {
    next.kind = override.kind;
  }
  if (override.props && descriptor.props) {
    const overridesByName = override.props;
    next.props = descriptor.props.map((p) => {
      const o = overridesByName[p.name];
      if (!o) return p;
      // Cast through string-type narrowing — `options` and `defaultValue`
      // shape vary per prop type, so we merge field-by-field and
      // preserve the discriminated union by keeping the original
      // `type` value.
      const merged: MdxComponentProp = { ...p };
      if (o.required !== undefined) merged.required = o.required;
      if (o.label !== undefined) merged.label = o.label;
      if (o.help !== undefined) merged.help = o.help;
      if (o.options && merged.type === 'string') {
        (merged as MdxComponentProp & { options?: ReadonlyArray<{ value: string; label: string }> }).options =
          o.options;
      }
      return merged;
    });
  }

  return next;
}

/** Internal accumulator. Combines interface-derived schema with
 * usage-derived observations as scans arrive. */
class DescriptorBuilder {
  private readonly name: string;
  private readonly source: string;
  private readonly defaultExport: boolean;
  /**
   * Component flow/text kind. Mutable across `observeUsage` calls
   * because mdast classifies the SAME component differently based on
   * how each instance is authored in source: `<Steps>...</Steps>` on
   * one line parses as `mdxJsxTextElement` (inline), but the same
   * component with blank-line-separated children parses as
   * `mdxJsxFlowElement` (block). The component's intrinsic nature is
   * "block" — so any single flow observation must promote the kind
   * from text to flow. Without this, one stray inline usage in a
   * fixture poisons the registry, MDXEditor mounts the JSX as inline,
   * and saves serialize block components as single-line MDX — which
   * Starlight's strict-slot validators (Steps wants `<ol>`, FileTree
   * wants `<ul>`) then reject at render time.
   *
   * Demotion in the other direction never happens: a component seen
   * as flow even once is intrinsically flow-capable, regardless of
   * other inline observations.
   */
  private kind: 'flow' | 'text';
  private readonly propsFromInterface: ParsedProp[];
  /** propName → set of distinct string values observed in MDX. */
  private readonly observedValues = new Map<string, Set<string>>();
  /** filepath → local alias used in that file (when ≠ canonical). */
  private readonly aliases: Record<string, string> = {};
  /** Names of props we've seen in usage but that aren't in the
   * interface (or for npm components where there's no interface). */
  private readonly observedPropNames = new Set<string>();
  /** How many `<Foo>` usages of this component were seen across all
   * MDX files. Used to pick a winner on name collisions. */
  private usageCount = 0;

  constructor(init: {
    name: string;
    source: string;
    defaultExport: boolean;
    kind: 'flow' | 'text';
    propsFromInterface?: ParsedProp[];
  }) {
    this.name = init.name;
    this.source = init.source;
    this.defaultExport = init.defaultExport;
    this.kind = init.kind;
    this.propsFromInterface = init.propsFromInterface ?? [];
  }

  observeUsage(
    attrs: Record<string, string>,
    filepath: string,
    localName: string,
    imp: MdxImport,
    observedKind: 'flow' | 'text',
  ): void {
    this.usageCount++;
    // Flow-wins promotion (see kind field doc above).
    if (observedKind === 'flow') this.kind = 'flow';
    if (imp.aliasedFrom && localName !== this.name) {
      this.aliases[filepath] = localName;
    }
    for (const [propName, value] of Object.entries(attrs)) {
      this.observedPropNames.add(propName);
      if (!this.observedValues.has(propName)) this.observedValues.set(propName, new Set());
      this.observedValues.get(propName)!.add(value);
    }
  }

  getUsageCount(): number {
    return this.usageCount;
  }

  getName(): string {
    return this.name;
  }

  hasInterfaceSchema(): boolean {
    return this.propsFromInterface.length > 0;
  }

  toDescriptor(): DiscoveredComponent {
    const interfacePropNames = new Set(this.propsFromInterface.map((p) => p.name));

    const props: MdxComponentProp[] = [];

    // Interface props first — full schema with types and (interface-
    // declared) options.
    for (const ip of this.propsFromInterface) {
      props.push(toMdxComponentProp(ip, this.observedValues.get(ip.name)));
    }

    // Usage-observed props that weren't in the interface (or were
    // never in any interface — npm components). Inferred as plain
    // strings; we don't auto-promote observed values to a dropdown
    // because there's no interface declaration telling us the prop
    // is meant to be enum-like. Authors who want a curated picker
    // can declare options via the sidecar `cmsConfig` override
    // (see scan-overrides.ts).
    for (const name of this.observedPropNames) {
      if (interfacePropNames.has(name)) continue;
      props.push({ name, type: 'string' });
    }

    // Build `defaults.attributes` for every required prop. The insert
    // flow (buildInsertPayload) merges these as starter attributes when
    // a fresh `<Component>` is dropped in, so components like
    // `<TabItem label="...">` never get inserted as `<TabItem />` and
    // immediately fail Astro's component validation at render time.
    //
    // Placeholder priority per prop:
    //   1. First literal-union option if the prop has one (Aside.type
    //      → 'note'). The component's own type system says this is a
    //      valid value, so it's the safest choice.
    //   2. First observed usage value if any author file already passes
    //      something (TabItem.label → 'Bun' from a Starlight fixture).
    //      Reuses authored content as the starter so the insert looks
    //      stylistically consistent with the rest of the project.
    //   3. Title-cased prop name as final fallback (Card.title →
    //      'Title'). Always editable — the placeholder text becomes the
    //      first thing the author clicks and overwrites.
    const requiredAttributes: Record<string, string | number | boolean> = {};
    for (const p of props) {
      if (!p.required) continue;
      requiredAttributes[p.name] = placeholderForProp(p, this.observedValues.get(p.name));
    }

    const descriptor: DiscoveredComponent = {
      name: this.name,
      kind: this.kind,
      hasChildren: true, // default — most components accept a body slot.
      props,
      import: { from: this.source, ...(this.defaultExport ? { default: true } : {}) },
      // Default `insert` metadata so the toolbar's "Insert component"
      // dropdown surfaces every auto-discovered component. Without
      // this, the toolbar's filter (`if (!d.insert) return false`)
      // hides the entry and users have no way to add the block from
      // the UI — only typed-out JSX would work. Hosts can still
      // override label/category via sidecar `cmsConfig` on the
      // component file (when that lands), but the sensible default
      // is the component's own name in a single "Components" bucket.
      insert: { label: this.name, category: 'Components' },
      ...(Object.keys(requiredAttributes).length > 0 ? { defaults: { attributes: requiredAttributes } } : {}),
    };
    if (Object.keys(this.aliases).length > 0) descriptor.aliases = this.aliases;
    return descriptor;
  }
}

/**
 * Pick a sensible starter value for a required prop so the insert flow
 * has something to put on the attribute. See the call site in
 * `DescriptorBuilder.toDescriptor` for the priority rationale; this
 * function just executes it.
 *
 * Number and boolean placeholders are intentionally trivial — `0` and
 * `true` — because numeric/boolean props are rare in MDX components and
 * any concrete value beats `undefined`. The interesting work is on the
 * string path, where union options and observed usage give us real
 * authored values to reuse.
 */
function placeholderForProp(prop: MdxComponentProp, observed: Set<string> | undefined): string | number | boolean {
  if (prop.type === 'number') return 0;
  if (prop.type === 'boolean') return true;
  // string
  if (prop.options && prop.options.length > 0) return prop.options[0].value;
  if (observed && observed.size > 0) {
    const first = observed.values().next();
    if (!first.done) return first.value;
  }
  // Title-case the prop name (`label` → `Label`). The author sees this
  // as the placeholder text on first insert; one click selects it for
  // overwrite.
  return prop.name.charAt(0).toUpperCase() + prop.name.slice(1);
}

function toMdxComponentProp(parsed: ParsedProp, observed: Set<string> | undefined): MdxComponentProp {
  // Only emit dropdown `options` when the interface itself declared a
  // literal union (eg `type?: 'note' | 'tip' | 'caution' | 'danger'`).
  // Free-form string props like `title`, `description`, `href` have no
  // such union — emitting an `options` array based purely on what we
  // observed in usage would lock authors to past values when the field
  // is meant to accept any text. The side panel renders prop fields with
  // options as `<select>` and prop fields without as `<input type=text>`,
  // so this single switch decides which one shows up. Observed values
  // can still enrich a real enum: when `parsed.options` IS set, append
  // any usage-seen values the interface didn't list (capped at 5 distinct).
  let optionStrings: string[] | undefined = parsed.options;
  if (optionStrings && observed && observed.size > 0) {
    const combined = new Set<string>(optionStrings);
    for (const v of observed) combined.add(v);
    if (combined.size <= 5) optionStrings = Array.from(combined);
  }

  if (parsed.type === 'number') {
    return { name: parsed.name, type: 'number', required: parsed.required };
  }
  if (parsed.type === 'boolean') {
    return { name: parsed.name, type: 'boolean', required: parsed.required };
  }
  // 'string' and 'expression' both render as a text input by default.
  // Treat 'expression' as a free-form string for editor purposes —
  // it's an escape hatch already.
  return {
    name: parsed.name,
    type: 'string',
    required: parsed.required,
    ...(optionStrings && optionStrings.length > 0
      ? { options: optionStrings.map((v) => ({ value: v, label: v })) }
      : {}),
  };
}
