import { afterEach, describe, expect, mock, test } from 'bun:test';
import { MDX_SANDBOX_FRAME_POLICY, SANDBOX_FRAME_CSP, sandboxFrameMain } from '../sandbox-frame.js';

test('the frame CSP runs inline scripts but never evals', () => {
  expect(SANDBOX_FRAME_CSP).not.toContain('unsafe-eval');
  expect(SANDBOX_FRAME_CSP).toContain("script-src 'unsafe-inline';");
});

/** Puts the test window at `origin`, inside a frame whose parent records what it is posted when `framed`. */
function frameAs(origin: string, framed: boolean) {
  document.body.innerHTML = '<div id="__sandbox_root"></div>';
  const spy = mock((_message: { kind: string }) => {});
  Object.defineProperty(self, 'origin', { value: origin, configurable: true });
  if (framed) Object.defineProperty(window, 'parent', { value: { postMessage: spy }, configurable: true });
  return spy;
}

describe('the preview frame refuses to run unless it is sandboxed', () => {
  const renderMessage = { __conlocaSandbox: true, kind: 'render', mode: 'html', payload: '<b>x</b>' };

  // The test DOM registers `origin` and `parent` as own globals, so deleting an
  // override would delete the global itself; put the originals back instead.
  const originals = {
    origin: Object.getOwnPropertyDescriptor(self, 'origin'),
    parent: Object.getOwnPropertyDescriptor(window, 'parent'),
  };
  afterEach(() => {
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(window, name, descriptor);
      else Reflect.deleteProperty(window, name);
    }
  });

  // The refusing cases run first: a frame that does start keeps its window
  // listeners, which would answer the messages later tests dispatch.
  test('does nothing on a real origin, even when framed', () => {
    const spy = frameAs('https://site.example', true);
    sandboxFrameMain();
    window.dispatchEvent(new MessageEvent('message', { data: renderMessage }));
    expect(spy).not.toHaveBeenCalled();
    expect(document.getElementById('__sandbox_root')?.innerHTML).toBe('');
  });

  test('does nothing when opened top level with an opaque origin', () => {
    frameAs('null', false);
    sandboxFrameMain();
    window.dispatchEvent(new MessageEvent('message', { data: renderMessage }));
    expect(document.getElementById('__sandbox_root')?.innerHTML).toBe('');
  });

  test('posts ready and renders inside a frame with an opaque origin', () => {
    const spy = frameAs('null', true);
    sandboxFrameMain();
    expect(spy.mock.calls.some(([message]) => message.kind === 'ready')).toBe(true);
    window.dispatchEvent(new MessageEvent('message', { data: renderMessage }));
    expect(document.getElementById('__sandbox_root')?.innerHTML).toBe('<b>x</b>');
  });

  test('ignores an MDX render message: no render, no error', async () => {
    const spy = frameAs('null', true);
    sandboxFrameMain();
    spy.mockClear();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          __conlocaSandbox: true,
          kind: 'render',
          mode: 'mdx',
          payload: "return {default: () => document.createTextNode('drawn')}",
        },
      }),
    );
    // The old MDX mode answered after its eval promise settled; let a few microtask turns pass.
    for (let turn = 0; turn < 5; turn++) {
      // oxlint-disable-next-line no-await-in-loop -- each turn must settle before the next.
      await Promise.resolve();
    }
    expect(spy).not.toHaveBeenCalled();
    expect(document.getElementById('__sandbox_root')?.innerHTML).toBe('');
  });

  test('HTML mode shows the sent bytes for an element src and keeps every other src', () => {
    frameAs('null', true);
    sandboxFrameMain();
    const images = { '/assets/hero.png': 'data:image/png;base64,AA==' };
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          __conlocaSandbox: true,
          kind: 'render',
          mode: 'html',
          payload: '<p><img src="/assets/hero.png" alt="h"><img src="/assets/other.png"></p>',
          images,
        },
      }),
    );
    const srcs = [...document.querySelectorAll('#__sandbox_root img')].map((img) => img.getAttribute('src'));
    expect(srcs).toEqual(['data:image/png;base64,AA==', '/assets/other.png']);
  });

  test('the response policy adds the sandbox directive', () => {
    expect(MDX_SANDBOX_FRAME_POLICY).toBe(`${SANDBOX_FRAME_CSP}; sandbox allow-scripts; frame-ancestors 'self'`);
  });
});
