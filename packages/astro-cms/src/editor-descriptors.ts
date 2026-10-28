import { isAbsolute } from 'node:path';
import { readEditorDataBindings } from '@conloca/content-api';
import type { MdxRegistryScanOptions } from './discovery/discover.js';
import type { EditorDataBindings, TemplateConfig } from './types.js';

/**
 * Env var through which `conlocaCMS` publishes the editor descriptors it
 * resolved during an Astro build, alongside `CONLOCA_CONTENT_ROOT`.
 *
 * The CMS resolves them once — the site's schemas module, its editor-build
 * options, the MDX registry scan inputs, the page templates and the routing
 * data bindings — so another integration in the same build reads the SAME
 * descriptors dev serves from `schemasPath`, `/api/registry` and its UI config
 * instead of taking those options a second time.
 */
export const EDITOR_DESCRIPTORS_ENV_VAR = 'CONLOCA_EDITOR_DESCRIPTORS';

export interface EditorDescriptorChannel {
  /** Absolute path of the host's schemas module (the `schemasPath` option), when configured. */
  schemasPath?: string;
  /**
   * Absolute path of the puck config module (the `puckConfigPath` option).
   * Optional only because an older `@conloca/astro-cms` wrote no such field;
   * this version always publishes it.
   */
  puckConfigPath?: string;
  /** Absolute paths of the `siteStyles` option, resolved against the Astro root, one entry per stylesheet. */
  siteStyles?: string[];
  /** Absolute paths of `editorStyles`, each resolved against the Astro root. */
  editorStyles?: string[];
  /** The `editorCSS` option, verbatim. */
  editorCSS?: string;
  /** Resolved inputs for the MDX component registry scan (`mdxComponentFolders` + the MDX content root). */
  registry: MdxRegistryScanOptions;
  /** Page-creation templates (the `templates` option), when configured. */
  templates?: Record<string, TemplateConfig>;
  /** The routing data bindings each page's data context is built from, when the site has content routes. */
  dataBindings?: EditorDataBindings;
  /** Absolute paths of every folder the content API writes to: the content root, the MDX pages root, the media folder. */
  contentPaths?: string[];
}

/**
 * Reads the channel conlocaCMS published, or undefined when it is absent or
 * unusable — a CMS-less build, or an older `@conloca/astro-cms`. Never throws:
 * descriptors are an enhancement to the editor, and a site's build must
 * not die over them.
 */
export function readEditorDescriptors(
  env: Record<string, string | undefined> = process.env,
): EditorDescriptorChannel | undefined {
  const raw = env[EDITOR_DESCRIPTORS_ENV_VAR];
  if (raw === undefined || raw === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const schemasPath = 'schemasPath' in parsed ? parsed.schemasPath : undefined;
  const puckConfigPath = 'puckConfigPath' in parsed ? parsed.puckConfigPath : undefined;
  const styleValue = 'siteStyles' in parsed ? parsed.siteStyles : undefined;
  const editorStyleValue = 'editorStyles' in parsed ? parsed.editorStyles : undefined;
  const editorCSS = 'editorCSS' in parsed ? parsed.editorCSS : undefined;
  const registry = 'registry' in parsed ? parsed.registry : undefined;
  const templateValue = 'templates' in parsed ? parsed.templates : undefined;
  const dataBindingValue = 'dataBindings' in parsed ? parsed.dataBindings : undefined;
  const contentPathValue = 'contentPaths' in parsed ? parsed.contentPaths : undefined;
  if (typeof registry !== 'object' || registry === null) return undefined;
  const contentRoot = 'contentRoot' in registry ? registry.contentRoot : undefined;
  const componentFolders = 'componentFolders' in registry ? registry.componentFolders : undefined;
  const projectRoot = 'projectRoot' in registry ? registry.projectRoot : undefined;
  const overridesFolder = 'overridesFolder' in registry ? registry.overridesFolder : undefined;
  if (
    typeof contentRoot !== 'string' ||
    !Array.isArray(componentFolders) ||
    !componentFolders.every((folder): folder is string => typeof folder === 'string')
  ) {
    return undefined;
  }
  const templates = readTemplates(templateValue);
  const dataBindings = readEditorDataBindings(dataBindingValue);
  const siteStyles =
    Array.isArray(styleValue) && styleValue.every((path): path is string => typeof path === 'string')
      ? styleValue
      : undefined;
  const editorStyles =
    Array.isArray(editorStyleValue) && editorStyleValue.every((path): path is string => typeof path === 'string')
      ? editorStyleValue
      : undefined;
  const contentPaths =
    Array.isArray(contentPathValue) &&
    contentPathValue.every((path): path is string => typeof path === 'string' && isAbsolute(path))
      ? contentPathValue
      : undefined;
  return {
    ...(typeof schemasPath === 'string' ? { schemasPath } : {}),
    ...(typeof puckConfigPath === 'string' ? { puckConfigPath } : {}),
    ...(siteStyles === undefined ? {} : { siteStyles }),
    ...(editorStyles === undefined ? {} : { editorStyles }),
    ...(typeof editorCSS === 'string' ? { editorCSS } : {}),
    registry: {
      contentRoot,
      componentFolders,
      ...(typeof projectRoot === 'string' ? { projectRoot } : {}),
      ...(typeof overridesFolder === 'string' ? { overridesFolder } : {}),
    },
    ...(templates === undefined ? {} : { templates }),
    ...(dataBindings === undefined ? {} : { dataBindings }),
    ...(contentPaths === undefined ? {} : { contentPaths }),
  };
}

/**
 * Per-entry validation: a malformed entry is dropped, the rest survive — one
 * bad template must not cost the create-page dialog all of them.
 */
function readTemplates(raw: unknown): Record<string, TemplateConfig> | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const templates: Record<string, TemplateConfig> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null) continue;
    const { label, component, pathPrefix, description } = value as Record<string, unknown>;
    if (typeof label !== 'string' || typeof component !== 'string') continue;
    templates[key] = {
      label,
      component,
      ...(typeof pathPrefix === 'string' ? { pathPrefix } : {}),
      ...(typeof description === 'string' ? { description } : {}),
    };
  }
  return Object.keys(templates).length > 0 ? templates : undefined;
}
