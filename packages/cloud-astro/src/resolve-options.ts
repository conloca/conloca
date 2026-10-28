import type { EditorDescriptorChannel } from '@conloca/astro-cms/node';
import { PACKAGE_NAME } from './constants.js';
import type { ConlocaCloudOptions } from './types.js';

/** The editor options `conlocaCMS` already holds, settled for this build. */
export interface InheritedOptions {
  puckConfigPath: string;
  siteStyles?: string[];
  editorStyles?: string[];
  editorCss?: string;
}

/**
 * Each option given to `conlocaCloud()` wins; the channel `conlocaCMS`
 * published fills the rest. `editorStyles` and `editorCss` come from the
 * channel only. Only `puckConfigPath` is mandatory: without it there is no
 * editor to build.
 */
export function resolveInheritedOptions(
  options: Pick<ConlocaCloudOptions, 'puckConfigPath' | 'siteStyles'>,
  channel: Pick<EditorDescriptorChannel, 'puckConfigPath' | 'siteStyles' | 'editorStyles' | 'editorCSS'> | undefined,
): InheritedOptions {
  const puckConfigPath = options.puckConfigPath ?? channel?.puckConfigPath;
  if (!puckConfigPath) {
    throw new Error(
      `${PACKAGE_NAME}: puckConfigPath is required: add it to conlocaCloud(), or add conlocaCMS() to this site's integrations`,
    );
  }
  const siteStyles =
    typeof options.siteStyles === 'string' ? [options.siteStyles] : (options.siteStyles ?? channel?.siteStyles);
  return {
    puckConfigPath,
    ...(siteStyles === undefined ? {} : { siteStyles }),
    ...(channel?.editorStyles === undefined ? {} : { editorStyles: channel.editorStyles }),
    ...(channel?.editorCSS === undefined ? {} : { editorCss: channel.editorCSS }),
  };
}
