import { describe, expect, it } from 'bun:test';
import type { EditorDescriptorChannel } from '@conloca/astro-cms/node';
import { resolveInheritedOptions } from '../resolve-options.js';

describe('resolveInheritedOptions', () => {
  const channel: EditorDescriptorChannel = {
    puckConfigPath: '/abs/puck.config.tsx',
    siteStyles: ['/abs/site.css'],
    registry: { contentRoot: '/abs/content', componentFolders: [] },
  };

  it('takes each option from conlocaCloud() over the channel', () => {
    const otherChannel: EditorDescriptorChannel = {
      puckConfigPath: '/b/puck.config.tsx',
      siteStyles: ['/b/site.css'],
      registry: channel.registry,
    };
    expect(resolveInheritedOptions({ puckConfigPath: './a.tsx', siteStyles: './a.css' }, otherChannel)).toEqual({
      puckConfigPath: './a.tsx',
      siteStyles: ['./a.css'],
    });
  });

  it('fills each absent option from the channel conlocaCMS published', () => {
    expect(resolveInheritedOptions({}, channel)).toEqual({
      puckConfigPath: '/abs/puck.config.tsx',
      siteStyles: ['/abs/site.css'],
    });
  });

  it('leaves out siteStyles when neither side has it', () => {
    const puckOnly: EditorDescriptorChannel = { puckConfigPath: '/abs/puck.config.tsx', registry: channel.registry };
    const result = resolveInheritedOptions({}, puckOnly);
    expect(Object.keys(result)).toEqual(['puckConfigPath']);
  });

  it('fails naming both ways to supply puckConfigPath when neither side has it', () => {
    expect(() => resolveInheritedOptions({}, undefined)).toThrow(
      "@conloca/cloud-astro: puckConfigPath is required: add it to conlocaCloud(), or add conlocaCMS() to this site's integrations",
    );
  });

  it('fills editorStyles and editorCss from the channel only', () => {
    const styled: EditorDescriptorChannel = {
      ...channel,
      editorStyles: ['/abs/editor.css'],
      editorCSS: '.x{color:red}',
    };
    expect(resolveInheritedOptions({ puckConfigPath: './a.tsx' }, styled)).toEqual({
      puckConfigPath: './a.tsx',
      siteStyles: ['/abs/site.css'],
      editorStyles: ['/abs/editor.css'],
      editorCss: '.x{color:red}',
    });
  });
});
