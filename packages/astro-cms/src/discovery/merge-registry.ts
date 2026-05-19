import type { MdxComponentProp, MdxJsxComponentDescriptor } from '@conloca/cms-spa/mdx-components';
import type { LocalComponentScanResult, ParsedProp } from './scan-components';
import type { MdxImport, MdxScanResult } from './scan-mdx';

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
      builder.observeUsage(usage.attrs, scan.filepath, usage.name, imp);
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
    winners.push(candidates[0].toDescriptor());
  }
  return winners;
}

/** Internal accumulator. Combines interface-derived schema with
 * usage-derived observations as scans arrive. */
class DescriptorBuilder {
  private readonly name: string;
  private readonly source: string;
  private readonly defaultExport: boolean;
  private readonly kind: 'flow' | 'text';
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

  observeUsage(attrs: Record<string, string>, filepath: string, localName: string, imp: MdxImport): void {
    this.usageCount++;
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
    // never in any interface — npm components). Inferred as strings
    // with usage-derived option suggestions.
    for (const name of this.observedPropNames) {
      if (interfacePropNames.has(name)) continue;
      const observed = this.observedValues.get(name);
      props.push({
        name,
        type: 'string',
        ...(observed && observed.size > 0 && observed.size <= 5
          ? { options: Array.from(observed).map((v) => ({ value: v, label: v })) }
          : {}),
      });
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
    };
    if (Object.keys(this.aliases).length > 0) descriptor.aliases = this.aliases;
    return descriptor;
  }
}

function toMdxComponentProp(parsed: ParsedProp, observed: Set<string> | undefined): MdxComponentProp {
  // Merge interface-declared options with usage-observed values:
  // anything seen in usage that the interface didn't list gets
  // appended (still capped at the 5-distinct dropdown heuristic).
  let optionStrings: string[] | undefined = parsed.options;
  if (observed && observed.size > 0) {
    const combined = new Set<string>(optionStrings ?? []);
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
