/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { ContentSandbox } from '../src/components/sandbox/ContentSandbox.js';
import { SANDBOX_FRAME_PATH } from '../src/components/sandbox/frame-runtime.js';
import { configureUI } from '../src/ui-config.js';

describe('the MDX sandbox frame address', () => {
  afterEach(() => {
    cleanup();
    configureUI({});
  });

  test('defaults to the shared sandbox route', () => {
    const { container } = render(<ContentSandbox mode="html" content="<p>x</p>" />);
    expect(container.querySelector('iframe')?.getAttribute('src')).toStartWith(`${SANDBOX_FRAME_PATH}?k=`);
  });

  test('uses the path the page configures', () => {
    configureUI({ sandboxFramePath: '/docs/_conloca/editor/sandbox-frame.html' });
    const { container } = render(<ContentSandbox mode="html" content="<p>x</p>" />);
    expect(container.querySelector('iframe')?.getAttribute('src')).toStartWith(
      '/docs/_conloca/editor/sandbox-frame.html?k=',
    );
  });
});
