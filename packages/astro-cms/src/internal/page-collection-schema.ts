import { type PageSchemas, toPageSchemaDescriptor } from '@conloca/cms-spa/page-schema-define';
import type { ContentMeta } from '@conloca/content-api';
import { type PageMeta, pageMetaSchema } from '@conloca/content-api/schemas';
import { z } from 'zod';

/**
 * Entry fields the content loader owns, written into every entry's data in
 * its load().
 *
 * None of them belong to `pageMetaSchema`, so under a page collection's schema
 * they survive only through the loose index signature. A host page-meta field
 * of the same name would replace the loader's value — a host `puckData` shape
 * would empty the page tree of every page in the built site.
 * `buildPageCollectionSchema` refuses those names with an error.
 *
 * Adding a field to the record the loader builds also means reserving it here.
 * Kept here, not in `loader.ts`, so this module stays free of the loader's
 * filesystem reader: a draft preview builds page schemas in a server runtime.
 */
export const LOADER_RESERVED_FIELDS = ['created', 'modified', 'name', 'data', 'mdx', 'puckData'] as const;

const CORE_FIELD_NAMES = new Set(Object.keys(pageMetaSchema.shape));
const RESERVED_FIELD_NAMES = new Set<string>(LOADER_RESERVED_FIELDS);

type RewriteKind = 'default' | 'catch' | 'transform' | 'coerce';

type ZodDef = {
  type?: string;
  coerce?: boolean;
  innerType?: z.ZodType;
  in?: z.ZodType;
  shape?: Record<string, z.ZodType> | (() => Record<string, z.ZodType>);
  element?: z.ZodType;
  options?: z.ZodType[];
  items?: z.ZodType[];
  valueType?: z.ZodType;
  keyType?: z.ZodType;
  rest?: z.ZodType;
  left?: z.ZodType;
  right?: z.ZodType;
  getter?: () => z.ZodType;
  catchall?: z.ZodType;
};

/**
 * `seen` breaks cycles through shared schema instances, but a z.lazy whose
 * factory builds fresh instances on every call defeats it — the depth cap is
 * the backstop. No real page-meta schema nests this deep.
 */
const MAX_REWRITE_WALK_DEPTH = 32;

function findRewrite(
  schema: z.ZodType,
  path: string,
  seen: Set<z.ZodType>,
  depth = 0,
): { kind: RewriteKind; path: string } | null {
  if (seen.has(schema) || depth > MAX_REWRITE_WALK_DEPTH) return null;
  seen.add(schema);
  const def = schema.def as ZodDef;
  if (def.type === 'default') return { kind: 'default', path };
  if (def.type === 'catch') return { kind: 'catch', path };
  if (def.type === 'pipe') return { kind: 'transform', path };
  if (def.coerce) return { kind: 'coerce', path };

  // Every child schema paired with the path it is reported under, in the
  // order the walk visits them — the first rewrite found is the one named
  // in the error, so this order is part of the contract.
  const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
  const children: [z.ZodType | undefined, string][] = [[def.innerType ?? def.in, path]];
  for (const [key, child] of Object.entries(shape ?? {})) {
    children.push([child, path ? `${path}.${key}` : key]);
  }
  children.push([def.element, `${path}[]`]);
  for (const option of def.options ?? []) {
    children.push([option, path]);
  }
  for (const [index, item] of (def.items ?? []).entries()) {
    children.push([item, `${path}[${index}]`]);
  }
  children.push(
    [def.rest, `${path}[]`],
    [def.keyType, path],
    [def.valueType, path],
    [def.left, path],
    [def.right, path],
    [def.getter?.(), path],
    [def.catchall, `${path}[*]`],
  );

  for (const [child, childPath] of children) {
    if (!child) continue;
    const found = findRewrite(child, childPath, seen, depth + 1);
    if (found) return found;
  }
  return null;
}

function assertHostFieldsAreSafe(shape: z.ZodRawShape): void {
  for (const [name, schema] of Object.entries(shape)) {
    if (CORE_FIELD_NAMES.has(name)) {
      throw new Error(
        `[conloca] pageSchemas cannot redeclare Conloca field "${name}". ` +
          'Title, pathname, locale, and the other core fields come from the CMS — put constraints on them in the editor schema, not here.',
      );
    }
    if (RESERVED_FIELD_NAMES.has(name)) {
      throw new Error(
        `[conloca] pageSchemas cannot declare "${name}". ` +
          'That field is owned by the content loader; a host schema of the same name would replace page content on every page.',
      );
    }
    const rewrite = findRewrite(schema as z.ZodType, name, new Set());
    if (rewrite) {
      throw new Error(
        `[conloca] pageSchemas field "${rewrite.path}" uses .${rewrite.kind}(), which rewrites values when Astro validates the collection ` +
          'and does not run in the editor preview. Use a plain field (optional string, array, …) and parse in one reader instead.',
      );
    }
  }
}

/**
 * Fold every page-schema descriptor into one Zod object of host meta fields.
 * Requiredness is not preserved — the caller always `.partial()`s this for the
 * collection, because Astro validates the whole `pages` pile.
 *
 * The merged object has one slot per field name, so two descriptors may only
 * declare the same name by sharing the same field schema instance — last-wins
 * would silently rewrite what the earlier prefix's pages are validated
 * against, failing them with a Zod error that names neither descriptor.
 */
export function hostFieldsFromPageSchemas(pageSchemas: PageSchemas): z.ZodObject<z.ZodRawShape> {
  // z.ZodRawShape's index signature is readonly, so the accumulator is spelled
  // with a mutable one.
  const shape: Record<string, z.ZodRawShape[string]> = {};
  const fieldOwner = new Map<string, string>();
  for (const [key, entry] of Object.entries(pageSchemas)) {
    const descriptor = toPageSchemaDescriptor(entry);
    // Rebuilding from .shape below silently drops object-level refinements,
    // so the refusal written for them has to run here, on the public path.
    assertNoObjectRefinements(descriptor.schema);
    // 'minimal'/'none' descriptors declare title for the form; strip those names so the collection guard does not fire.
    const mode = descriptor.coreFields?.mode;
    const stripCore = mode === 'minimal' || mode === 'none';
    for (const [name, field] of Object.entries(descriptor.schema.shape)) {
      if (stripCore && CORE_FIELD_NAMES.has(name)) continue;
      const owner = fieldOwner.get(name);
      if (owner !== undefined && shape[name] !== field) {
        throw new Error(
          `[conloca] pageSchemas "${owner}" and "${key}" both declare field "${name}" with different schemas. ` +
            'The merged collection schema has one slot per field name — declare the field once and import it ' +
            'into both schemas, or rename one of the fields.',
        );
      }
      fieldOwner.set(name, owner ?? key);
      shape[name] = field;
    }
  }
  return z.object(shape);
}

/**
 * A page collection entry as the loader delivers it: the validated
 * `pageMetaSchema` fields, the loader-written record fields (`created`,
 * `modified`, `name`, `puckData` — admitted by the loose index at runtime),
 * and the host's meta fields through `ContentMeta`/`HostPageMeta`.
 */
export type ConlocaPageEntry = ContentMeta &
  PageMeta & {
    created?: string | Date;
    modified?: string | Date;
    name?: string;
    puckData?: unknown;
  };

/**
 * The schema Astro validates page entries against: the host's page-meta fields
 * (all optional) with conloca's structural fields layered over them, loose so
 * undeclared top-level fields still reach the rendered page.
 *
 * Looseness is TOP-LEVEL ONLY. A nested `z.object()` still strips undeclared
 * nested keys; a host that wants them preserved has to write `z.looseObject()`.
 *
 * Rewrite bans (.default / .coerce / .transform / .catch) walk nested objects,
 * arrays, and unions. `.partial()` is still shallow.
 *
 * Internal on purpose: `src/collections.ts` is a published entry (the
 * `./collections` subpath), so anything exported from there is frozen under
 * semver. Nothing outside this package consumes it.
 */
export function buildPageCollectionSchema(hostFields: z.ZodObject<z.ZodRawShape>): z.ZodType<ConlocaPageEntry> {
  assertNoObjectRefinements(hostFields);
  assertHostFieldsAreSafe(hostFields.shape);
  // The one declared seam in the typed-collections design: the runtime
  // schema validates core + host fields and loosely admits the loader-written
  // record fields, but TypeScript cannot see host fields through the loose
  // index. The static type is asserted as the flattened entry instead, which
  // is the same contract listings already rely on — a host declaring
  // `HostPageMeta` promises it matches its `pageSchemas`. Pinned by the type
  // proofs here and in the type proofs of a site that declares `HostPageMeta`.
  return z.looseObject({
    ...hostFields.partial().shape,
    ...pageMetaSchema.shape,
  }) as unknown as z.ZodType<ConlocaPageEntry>;
}

/**
 * .partial() throws on a refined object, and a refined object still satisfies
 * both the host-fields signature and the pageSchemas field type, so the raw
 * zod error would surface while Astro loads content.config.ts naming neither
 * conloca nor pageSchemas. Refuse it with something the host can act on —
 * both on the fold over pageSchemas (which would otherwise silently DROP the
 * refinement while rebuilding from .shape) and on direct host-fields callers.
 */
function assertNoObjectRefinements(schema: z.ZodObject<z.ZodRawShape>): void {
  if ((schema.def.checks?.length ?? 0) > 0) {
    throw new Error(
      '[conloca] pageSchemas cannot carry object-level refinements (.refine, .superRefine or .check). ' +
        'Conloca makes every host field optional — page schemas are prefix-scoped in the editor while ' +
        'Astro validates a whole collection — and Zod cannot make a refined object partial. ' +
        'Move the rule onto the individual field schemas instead.',
    );
  }
}
