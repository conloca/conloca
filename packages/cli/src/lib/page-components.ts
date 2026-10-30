import { isSlotContent } from '@conloca/astro-cms/checks';
import type { PuckManifest } from '@conloca/astro-cms/puck-manifest';
import { type CallOptions, stringLiteral } from './config-text.js';
import { isRecord } from './is-record.js';

export type SiteComponents = { manifest: PuckManifest } | { reason: string };

/** The site's Puck manifest, or why the config path could not be read from conlocaCMS options. */
export async function readSiteComponents(projectDir: string, cmsOptions: CallOptions): Promise<SiteComponents> {
  if (cmsOptions.state === 'no-call') {
    return { reason: 'conlocaCMS(...) is never called in the astro config, so it names no puckConfigPath' };
  }
  const puckConfigPath =
    cmsOptions.state === 'literal' ? stringLiteral(cmsOptions.entries.get('puckConfigPath') ?? '') : null;
  if (puckConfigPath === null) {
    return { reason: "puckConfigPath is not a plain string in conlocaCMS(...) — set it like './src/puck.config.tsx'" };
  }
  // Lazy: the reader loads the TypeScript compiler, so only a caller that needs the manifest pays for it.
  const { endpointReaderOptions, readPuckConfig } = await import('@conloca/astro-cms/puck-manifest');
  return { manifest: readPuckConfig(endpointReaderOptions({ puckConfigPath, projectRoot: projectDir })) };
}

/** Something a page stores that the Puck config does not declare: a component type, or one of its props when `field` is set. */
export interface ComponentFinding {
  component: string;
  field?: string;
}

/** The top-level item lists of stored Puck data: `content`, then every zone. */
function itemLists(puckData: unknown): unknown[] {
  if (!isRecord(puckData)) return [];
  return [puckData.content, ...(isRecord(puckData.zones) ? Object.values(puckData.zones) : [])];
}

/** True when the stored Puck data holds at least one component. */
export function hasPuckItems(puckData: unknown): boolean {
  return itemLists(puckData).some(isSlotContent);
}

/**
 * The component types and props a page's Puck data uses that the manifest does
 * not declare, once each, in page order. Slots are found by shape, so items
 * under a component the config no longer declares are still walked. Nothing is
 * reported where the config could not be read: an `unreadable` manifest may
 * declare more types, and a component with unreadable or computed fields may
 * accept any prop. Fragment_* items are registered only at render.
 */
export function componentFindings(puckData: unknown, manifest: PuckManifest): ComponentFinding[] {
  const findings = new Map<string, ComponentFinding>();
  const report = (finding: ComponentFinding): void => {
    findings.set(`${finding.component}\0${finding.field ?? ''}`, finding);
  };

  const check = (type: string, propNames: readonly string[]): void => {
    const component = Object.hasOwn(manifest.components, type) ? manifest.components[type] : undefined;
    if (component === undefined) {
      if (!manifest.unreadable && !manifest.unresolved.includes(type)) report({ component: type });
      return;
    }
    // An unread defaultProps may hold any key, so then only the fields count.
    const defaults = component.unreadableKeys?.includes('defaultProps') ? undefined : (component.defaultProps ?? {});
    if (component.fieldsUnreadable || component.dynamicFields || defaults === undefined) return;
    for (const key of propNames) {
      if (key !== 'id' && !Object.hasOwn(component.fields, key) && !Object.hasOwn(defaults, key)) {
        report({ component: type, field: key });
      }
    }
  };

  const visit = (items: unknown): void => {
    if (!isSlotContent(items)) return;
    for (const { type = '', props } of items) {
      if (!type.startsWith('Fragment_')) check(type, Object.keys(props ?? {}));
      for (const value of Object.values(props ?? {})) visit(value);
    }
  };

  for (const items of itemLists(puckData)) visit(items);
  return [...findings.values()];
}
