import {
  type MdxComponentDescriptor,
  type MdxJsxComponentDescriptor,
  mergeDiscoveredMdxComponents,
} from '@conloca/cms-spa/mdx-components-define';
import {
  type FragmentManifest,
  type FragmentManifestComponent,
  type FragmentManifestProp,
  isRecord,
} from '@conloca/content-api/component-vocabulary';
import type { FragmentVocabulary } from '@conloca/mdx/render';
import type { UserConfig } from 'vite';
import { strategyOf } from '../components/FragmentIsland.js';
import { fragmentVocabularyOf } from '../handlers/page-render-core.js';
import { loadFragmentRender } from './fragment-render-load.js';

export { type CheckEntry, loadFragmentRender } from './fragment-render-load.js';

/** A built fragment manifest, and a warning for each descriptor prop it left out. */
export interface FragmentManifestResult {
  manifest: FragmentManifest;
  warnings: string[];
}

// A JSX descriptor by shape; its props are parsed one by one below, since they come from site code.
const isJsxDescriptor = (value: unknown): value is MdxJsxComponentDescriptor =>
  isRecord(value) && typeof value.name === 'string' && (value.kind === 'flow' || value.kind === 'text');

// Any descriptor by its name alone, for the merge; the JSX filter after it reads the rest.
const isNamedDescriptor = (value: unknown): value is MdxComponentDescriptor =>
  isRecord(value) && typeof value.name === 'string';

const optionalString = (value: unknown) => (typeof value === 'string' ? value : undefined);

/** A descriptor prop or field as a manifest prop; `undefined` when its shape is not one the manifest describes. */
function manifestProp(value: unknown): FragmentManifestProp | undefined {
  if (!isRecord(value)) return undefined;
  const common = {
    ...(typeof value.label === 'string' ? { label: value.label } : {}),
    ...(typeof value.help === 'string' ? { help: value.help } : {}),
    ...(value.required === true ? { required: true as const } : {}),
  };
  const fallback = value.defaultValue;
  switch (value.type) {
    case 'string': {
      const options = value.options;
      if (options !== undefined) {
        if (!Array.isArray(options)) return undefined;
        if (!options.every((o) => isRecord(o) && typeof o.value === 'string' && typeof o.label === 'string')) {
          return undefined;
        }
      }
      return {
        type: 'string',
        ...common,
        ...(typeof fallback === 'string' ? { default: fallback } : {}),
        ...(options ? { options: options.map((o) => ({ value: String(o.value), label: String(o.label) })) } : {}),
      };
    }
    case 'number':
      return { type: 'number', ...common, ...(typeof fallback === 'number' ? { default: fallback } : {}) };
    case 'boolean':
      return { type: 'boolean', ...common, ...(typeof fallback === 'boolean' ? { default: fallback } : {}) };
    case 'list': {
      const of = manifestProp(value.of);
      return of ? { type: 'list', ...common, of } : undefined;
    }
    case 'object': {
      if (!isRecord(value.fields)) return undefined;
      const fields: Record<string, FragmentManifestProp> = {};
      for (const [name, field] of Object.entries(value.fields)) {
        const prop = manifestProp(field);
        if (!prop) return undefined;
        fields[name] = prop;
      }
      return { type: 'object', ...common, fields };
    }
    default:
      return undefined;
  }
}

/**
 * The manifest of a loaded vocabulary: every component it declares with the descriptor the editor uses for it
 * (host-authored wins over discovered for these names), its hydration and its outline entry, and its element overrides.
 */
export function fragmentManifestOf(input: {
  vocabulary: FragmentVocabulary;
  mdxComponents: unknown;
  discovered: readonly unknown[];
}): FragmentManifestResult {
  const { vocabulary } = input;
  const names = Object.keys(vocabulary.components);
  // Merge every descriptor kind first, as the editor does, so a host snippet of a vocabulary name still wins.
  const host = (Array.isArray(input.mdxComponents) ? input.mdxComponents : []).filter(isNamedDescriptor);
  const merged = mergeDiscoveredMdxComponents(host, input.discovered.filter(isNamedDescriptor), new Set(names));
  const descriptors = new Map(merged.filter(isJsxDescriptor).map((d) => [d.name, d]));
  const warnings: string[] = [];
  const components: Record<string, FragmentManifestComponent> = {};
  for (const name of names) {
    const entry: FragmentManifestComponent = {};
    const outline = vocabulary.outline?.[name];
    if (outline) entry.outline = { id: outline.id, text: outline.text };
    const hydrate = strategyOf(vocabulary.components[name]);
    if (hydrate) entry.hydrate = hydrate;
    const descriptor = descriptors.get(name);
    if (descriptor) {
      entry.kind = descriptor.kind;
      const label = optionalString(descriptor.insert?.label);
      if (label !== undefined) entry.label = label;
      const description = optionalString(descriptor.insert?.description);
      if (description !== undefined) entry.description = description;
      if (descriptor.hasChildren === true) entry.children = true;
      const props: Record<string, FragmentManifestProp> = {};
      for (const prop of Array.isArray(descriptor.props) ? descriptor.props : []) {
        if (!isRecord(prop) || typeof prop.name !== 'string') continue;
        const parsed = manifestProp(prop);
        if (parsed) props[prop.name] = parsed;
        else {
          warnings.push(
            `fragment component ${name}: prop ${prop.name} has a type the component manifest cannot describe, so agent writes do not check it`,
          );
        }
      }
      entry.props = props;
    }
    components[name] = entry;
  }
  return { manifest: { components, elements: Object.keys(vocabulary.elements) }, warnings };
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const unreadable = (unreadableReason: string): FragmentManifestResult => ({
  manifest: { components: {}, elements: [], unreadable: true, unreadableReason },
  warnings: [],
});

/**
 * The fragment manifest of a build. Never throws: a site without `fragmentComponentsPath` lists nothing, and a render
 * or schemas module that failed to load lists nothing and says why. `schemas: undefined` means the site sets no
 * `schemasPath`, so no host-authored descriptors.
 */
export async function readFragmentManifest(input: {
  root: string;
  vite: UserConfig;
  fragmentComponentsPath?: string;
  schemas: { mdxComponents: unknown } | { error: string } | undefined;
  discovered: readonly unknown[];
}): Promise<FragmentManifestResult> {
  const { fragmentComponentsPath, schemas } = input;
  if (!fragmentComponentsPath) return { manifest: { components: {}, elements: [] }, warnings: [] };
  let vocabulary: FragmentVocabulary;
  try {
    const { render } = await loadFragmentRender({ root: input.root, vite: input.vite, fragmentComponentsPath });
    vocabulary = fragmentVocabularyOf(render, fragmentComponentsPath);
  } catch (error) {
    return unreadable(`${fragmentComponentsPath} failed to load: ${messageOf(error)}`);
  }
  if (schemas && 'error' in schemas) return unreadable(`the schemas module failed to load: ${schemas.error}`);
  return fragmentManifestOf({ vocabulary, mdxComponents: schemas?.mdxComponents, discovered: input.discovered });
}
