import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import { ContentSandbox } from './ContentSandbox.js';

/**
 * Browser-proven isolation of the sandboxed content frame. These stories run in
 * a real Chromium instance (the Storybook browser pipeline), so the `sandbox="allow-scripts"`
 * frame gets a genuine opaque origin — the only place the cross-origin escape
 * attempts below actually throw. The play functions arm tripwires on the
 * privileged parent window and assert a hostile payload that provably executes
 * (the frame reports `rendered`) still cannot reach the parent's globals,
 * cookies, or React tree.
 */

interface EscapeWindow extends Window {
  __SANDBOX_ESCAPED__?: boolean;
  __SANDBOX_CLIENT_CALLED__?: boolean;
  __CONTENT_API_CLIENT__?: { mutate: () => void };
  __QUERY_CLIENT__?: unknown;
}

/** A compiled MDX body (as the server would emit) that tries every escape
 * before returning a valid component — simulating a sanitizer bypass or a
 * malicious registry component reaching the eval. */
const HOSTILE_MDX_COMPILED = [
  'try { window.parent.__SANDBOX_ESCAPED__ = true; } catch (e) {}',
  'try { if (window.parent.__CONTENT_API_CLIENT__) window.parent.__CONTENT_API_CLIENT__.mutate(); } catch (e) {}',
  'try { var c = window.top.document.cookie; if (c) window.parent.__SANDBOX_COOKIE__ = c; } catch (e) {}',
  'const { jsx } = arguments[0];',
  "return { default: function MDXContent() { return jsx('p', { children: 'rendered inside the sandbox' }); } };",
].join('\n');

const HOSTILE_HTML = [
  '<img src="x" onerror="try{window.parent.__SANDBOX_ESCAPED__=true}catch(e){}">',
  '<a href="javascript:(window.parent.__SANDBOX_ESCAPED__=true)">link</a>',
  '<p>visible</p>',
].join('');

/** Arms parent-window tripwires, mounts the sandbox, and reports when the
 * frame has executed its payload (via the frame's own `rendered` message). */
function IsolationHarness({ mode, content }: { mode: 'mdx' | 'html'; content: string }) {
  const [executed, setExecuted] = React.useState(false);
  React.useEffect(() => {
    const w = window as EscapeWindow;
    w.__SANDBOX_ESCAPED__ = false;
    w.__SANDBOX_CLIENT_CALLED__ = false;
    w.__CONTENT_API_CLIENT__ = {
      mutate: () => {
        w.__SANDBOX_CLIENT_CALLED__ = true;
      },
    };
    w.__QUERY_CLIENT__ = { secret: true };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { __conlocaSandbox?: boolean; kind?: string } | undefined;
      if (data?.__conlocaSandbox && data.kind === 'rendered') setExecuted(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return (
    <div>
      <div data-testid="frame-executed">{executed ? 'yes' : 'no'}</div>
      <ContentSandbox mode={mode} content={content} />
    </div>
  );
}

function EmptyContentHarness() {
  const [content, setContent] = React.useState('<p>stale sandbox output</p>');
  const [renderCount, setRenderCount] = React.useState(0);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { __conlocaSandbox?: boolean; kind?: string } | undefined;
      if (data?.__conlocaSandbox && data.kind === 'rendered') setRenderCount((count) => count + 1);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div>
      <button type="button" onClick={() => setContent('')}>
        Clear content
      </button>
      <div data-testid="render-count">{renderCount}</div>
      <ContentSandbox mode="html" content={content} />
    </div>
  );
}

const meta = {
  component: ContentSandbox,
  // Default args satisfy `StoryObj`'s required-prop check; every story below
  // fully overrides `render`, so these are never read at runtime.
  args: { mode: 'mdx', content: '' },
} satisfies Meta<typeof ContentSandbox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Canary: the sandbox renders benign MDX in an isolated frame. */
export const RendersMdx: Story = {
  render: () => <ContentSandbox mode="mdx" content={HOSTILE_MDX_COMPILED} />,
  play: async ({ canvasElement }) => {
    const frame = canvasElement.querySelector('iframe');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame?.getAttribute('sandbox') ?? '').not.toContain('allow-same-origin');
  },
};

export const HostileMdxCannotEscape: Story = {
  render: () => <IsolationHarness mode="mdx" content={HOSTILE_MDX_COMPILED} />,
  play: async ({ canvasElement }) => {
    const executed = canvasElement.querySelector('[data-testid="frame-executed"]');
    await waitFor(() => expect(executed?.textContent).toBe('yes'), { timeout: 5000 });
    const w = window as EscapeWindow;
    expect(w.__SANDBOX_ESCAPED__).toBe(false);
    expect(w.__SANDBOX_CLIENT_CALLED__).toBe(false);
    // The rendered content lives in the opaque frame, not this document.
    expect(canvasElement.textContent).not.toContain('rendered inside the sandbox');
  },
};

export const HostileHtmlCannotEscape: Story = {
  render: () => <IsolationHarness mode="html" content={HOSTILE_HTML} />,
  play: async ({ canvasElement }) => {
    const executed = canvasElement.querySelector('[data-testid="frame-executed"]');
    await waitFor(() => expect(executed?.textContent).toBe('yes'), { timeout: 5000 });
    const w = window as EscapeWindow;
    expect(w.__SANDBOX_ESCAPED__).toBe(false);
    expect(canvasElement.textContent).not.toContain('visible');
  },
};

export const EmptyContentClearsRenderedOutput: Story = {
  render: () => <EmptyContentHarness />,
  play: async ({ canvasElement }) => {
    const renderCount = canvasElement.querySelector('[data-testid="render-count"]');
    await waitFor(() => expect(Number(renderCount?.textContent)).toBeGreaterThan(0), { timeout: 5000 });
    // Let readiness retries finish so only the empty-content delivery can
    // produce the next rendered acknowledgement.
    await new Promise((resolve) => window.setTimeout(resolve, 1100));
    const beforeClear = Number(renderCount?.textContent);

    await userEvent.click(canvasElement.querySelector('button') as HTMLButtonElement);

    await waitFor(() => expect(Number(renderCount?.textContent)).toBeGreaterThan(beforeClear), { timeout: 5000 });
  },
};
