import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import fg from 'fast-glob';

/**
 * Host-provided override for an auto-discovered component descriptor.
 *
 * Lives in a sidecar JSON file inside the configured overrides folder
 * (default `src/cms-overrides/`). One file per component, keyed by
 * basename: `Card.cms.json` overrides the auto-discovered `Card`.
 *
 * Why JSON, not TS:
 *   - Zero tooling. The host doesn't need to import any types, set up
 *     build steps, or worry about which export shape we expect.
 *   - Static — we don't have to spin up Vite's SSR loader to read it.
 *   - Survives copy/paste between projects.
 *
 * The shape is intentionally a flat subset of `MdxJsxComponentDescriptor` —
 * not the full union — because hosts only need to override the
 * fields that come up in practice (insert menu hints, prop schema
 * tweaks, defaults). New fields can be added later without breaking
 * existing JSON files.
 */
export interface CmsOverride {
  /** Override the slash-menu / toolbar entry (label, category, icon, etc.). */
  insert?: {
    label?: string;
    description?: string;
    category?: string;
    icon?: string;
    keywords?: string[];
  };
  /** Override the insert-time starter attribute values. Merges over
   * the auto-derived `defaults.attributes` so hosts can pin specific
   * placeholder text or set a default for a prop the inference missed. */
  defaults?: {
    attributes?: Record<string, string | number | boolean>;
    /** Raw MDX snippet parsed to mdast children at insert time. */
    children?: string;
  };
  /** Per-prop overrides keyed by prop name. Fields here merge over
   * the inferred prop schema (matched by `name`). Useful when:
   *   - The interface scan missed `required` (rare type pattern).
   *   - You want explicit help text or a friendly label.
   *   - You want a curated `options` list instead of usage-observed values. */
  props?: Record<
    string,
    {
      required?: boolean;
      label?: string;
      help?: string;
      options?: Array<{ value: string; label: string }>;
    }
  >;
  /** Override whether the component accepts children. Inferred to
   * `true` by default; set to `false` for self-closing components. */
  hasChildren?: boolean;
  /** Override the flow/text kind. The flow-wins promotion in
   * `merge-registry.ts` usually gets this right, but a host can
   * pin the kind explicitly here if their fixtures don't exercise
   * the block-context usage. */
  kind?: 'flow' | 'text';
}

/**
 * Read every `*.cms.json` file under `folder` (recursive) and return
 * the parsed overrides keyed by basename (`Card.cms.json` → `Card`).
 *
 * Failures are skipped with a warning — a broken JSON file shouldn't
 * take down the rest of the registry build. The folder being empty
 * (or not existing) returns an empty map silently; that's the
 * common zero-config case where the host hasn't added any
 * overrides yet.
 */
export async function loadCmsOverrides(folder: string, projectRoot: string): Promise<Map<string, CmsOverride>> {
  const out = new Map<string, CmsOverride>();
  if (!folder) return out;
  const pattern = `${folder.replace(/\/+$/, '')}/**/*.cms.json`;
  const files = await fg(pattern, { cwd: projectRoot, absolute: true, dot: false });
  for (const file of files) {
    try {
      const content = await readFile(file, 'utf8');
      const parsed = JSON.parse(content) as CmsOverride;
      const base = basename(file);
      const name = base.slice(0, -'.cms.json'.length);
      out.set(name, parsed);
    } catch (err) {
      console.warn(`[conloca:discovery] failed to load override ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  return out;
}
