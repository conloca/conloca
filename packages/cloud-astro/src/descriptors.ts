import type { MdxRegistryScanOptions } from '@conloca/astro-cms/node';
import {
  discoverMdxComponents,
  EDITOR_DESCRIPTORS_ENV_VAR,
  readEditorDescriptors,
  toPortableImports,
} from '@conloca/astro-cms/node';
import type { EditorBundleDescriptors } from './editor-page/bundle.js';

/**
 * The MDX discovery seam, so tests can drive the failure path without a
 * fixture project.
 */
export type MdxDescriptorScan = (options: MdxRegistryScanOptions) => Promise<readonly unknown[]>;

/**
 * Runs conlocaCMS's own registry scan and makes its local-component import
 * specifiers portable — the descriptors are serialized into the site's
 * MDX files on save, where a build agent's absolute path would be a
 * committed dead link.
 */
const scanMdxDescriptors: MdxDescriptorScan = async (options) => {
  // Resolved ONCE and handed to both calls: the scan and the portability
  // rewrite must agree on the root, or a drift in either default would
  // produce non-portable paths with no failing test.
  const projectRoot = options.projectRoot ?? process.cwd();
  return toPortableImports(await discoverMdxComponents({ ...options, projectRoot }), projectRoot);
};

/**
 * Resolves the editor descriptors for this build from the channel conlocaCMS
 * published — the bundle's third leg, next to the puck config and the styles.
 *
 * The editor at the endpoint has no dev server to serve `/api/registry` from,
 * so the scan runs HERE and its output is compiled into the bundle. Fail-soft throughout: a
 * scan failure costs the auto-discovered half and warns; an absent channel (a
 * CMS-less build) is simply a build with no descriptors; a PRESENT but
 * unreadable channel warns — that is version drift between this package and
 * `@conloca/astro-cms`, not a CMS-less build, and silence would strip every
 * schema from the editor at the endpoint with no diagnostic. The bundle itself stays
 * fail-hard, unchanged.
 */
export async function resolveEditorDescriptors(
  logger: { info(message: string): void; warn(message: string): void },
  env: Record<string, string | undefined> = process.env,
  scan: MdxDescriptorScan = scanMdxDescriptors,
): Promise<EditorBundleDescriptors | undefined> {
  const channel = readEditorDescriptors(env);
  if (channel === undefined) {
    if (env[EDITOR_DESCRIPTORS_ENV_VAR] !== undefined && env[EDITOR_DESCRIPTORS_ENV_VAR] !== '') {
      logger.warn(
        `${EDITOR_DESCRIPTORS_ENV_VAR} is set but unreadable — @conloca/astro-cms and @conloca/cloud-astro ` +
          'versions may have drifted; the editor at the endpoint gets no schemas or MDX descriptors from this build, ' +
          'and agents get no component manifest',
      );
    }
    return undefined;
  }

  let discovered: readonly unknown[] = [];
  try {
    discovered = await scan(channel.registry);
  } catch (error) {
    logger.warn(
      'MDX component discovery failed — the editor at the endpoint gets the site-authored descriptors only ' +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const templateCount = Object.keys(channel.templates ?? {}).length;
  const { dataBindings } = channel;
  if (
    channel.schemasPath === undefined &&
    discovered.length === 0 &&
    templateCount === 0 &&
    dataBindings === undefined
  ) {
    return undefined;
  }
  logger.info(
    `editor descriptors: ${discovered.length} auto-discovered MDX component(s)` +
      (channel.schemasPath ? ` plus the host schemas module (${channel.schemasPath})` : '') +
      (templateCount > 0 ? ` plus ${templateCount} page template(s)` : '') +
      (dataBindings ? ` plus the data bindings of ${Object.keys(dataBindings.routes).length} page collection(s)` : ''),
  );
  return {
    ...(channel.schemasPath === undefined ? {} : { schemasPath: channel.schemasPath }),
    ...(discovered.length === 0 ? {} : { discoveredMdxComponents: discovered }),
    ...(templateCount === 0 ? {} : { templates: channel.templates }),
    ...(dataBindings === undefined ? {} : { dataBindings }),
  };
}
