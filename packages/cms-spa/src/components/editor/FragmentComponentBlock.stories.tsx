import { defineFragmentComponents } from '@conloca/mdx/render';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import { expect, waitFor } from 'storybook/test';
import {
  hostileCases,
  hostileComponents,
  hostileElements,
} from '../../../../mdx/src/__tests__/fixtures/hostile-cases.js';
import { setSiteRender } from '../../site-render.js';
import { CspFrame, expectCspInForce, fired, hostileMdx, restores } from '../puck/csp-frame-harness.js';
import { CMSMDXEditor } from './CMSMDXEditor.js';
import { FragmentComponentBlock } from './FragmentComponentBlock.js';

/**
 * The fragment editor's typing surface renders site components in the editor page itself, outside any srcdoc frame.
 * Mounted here under the editor page's CSP with hostile props, its components must render with no handler, style or
 * script-scheme URL, and activating them must neither execute nor navigate. No `previewRouteUrl`: the tripwire records
 * every fetch, so the surface must make none, and none to `/api/render`.
 */

const vocabulary = defineFragmentComponents({
  components: {
    ...hostileComponents,
    Spread: (p: ComponentProps<'a'>) => (
      <a data-testid="spread" {...p}>
        {p.children}
      </a>
    ),
    Img: (p: ComponentProps<'img'>) => <img data-testid="img" alt="" {...p} />,
    // Navigating site components; each passes its props through, so the author's target reaches the DOM.
    Go: (p: ComponentProps<'a'>) => (
      <a data-testid="go" href="/x" {...p}>
        go
      </a>
    ),
    MapArea: () => (
      <span data-testid="maparea">
        <map name="fm">
          <area href="/x" shape="rect" coords="0,0,10,10" alt="a" />
        </map>
      </span>
    ),
    Submit: () => (
      <form data-testid="submit" action="/x">
        <button type="submit">s</button>
      </form>
    ),
    Outside: () => (
      <button data-testid="outside" type="submit" form="outside" formAction="/x">
        o
      </button>
    ),
  },
  elements: hostileElements,
});

const hostileImg = `<Img src="javascript:window.__pwned=1" onError="window.__pwned=1" STYLE="background:url(https://evil.test/i)" />`;

const value = [
  hostileMdx,
  hostileImg,
  '<Go target="_top" />',
  '<Go target="_parent" />',
  '<MapArea />',
  '<Submit />',
  '<Outside />',
  ...Object.values(hostileCases)
    .filter((c) => c.renders)
    .map((c) => c.mdx),
].join('\n\n');

const queryClient = new QueryClient();

function HostileFragmentEditor() {
  return (
    <CspFrame>
      <QueryClientProvider client={queryClient}>
        <CMSMDXEditor value={value} onChange={() => {}} fragment />
      </QueryClientProvider>
    </CspFrame>
  );
}

const meta = {
  title: 'Editor/FragmentComponentBlock',
  component: FragmentComponentBlock,
  // The block needs the editor around it; the hostile editor mounts it for every component in `value`.
  render: () => <HostileFragmentEditor />,
  beforeEach: () => {
    fired.length = 0;
    setSiteRender({ vocabulary });
    return () => {
      for (const restore of restores.splice(0)) restore();
      setSiteRender({});
    };
  },
} satisfies Meta<typeof FragmentComponentBlock>;

export default meta;

// The meta renders the hostile editor, so stories take no block args.
type Story = StoryObj;

const settle = () => new Promise((resolve) => window.setTimeout(resolve, 300));

const scriptScheme = /^\s*(javascript|vbscript|data:text\/html)/i;

export const HostilePropsCannotExecute: Story = {
  play: async ({ canvasElement }) => {
    const frameElement = canvasElement.querySelector<HTMLIFrameElement>('iframe[title="Canvas"]');
    // Positive control: the site components rendered (the void Img gets no nested editor).
    await waitFor(
      async () => {
        const doc = frameElement?.contentDocument;
        await expect(doc?.querySelector('[data-testid="spread"]')).toBeTruthy();
        await expect(doc?.querySelector('[data-testid="img"]')).toBeTruthy();
      },
      { timeout: 10000 },
    );
    const frame = frameElement?.contentWindow;
    const doc = frameElement?.contentDocument;
    if (!frame || !doc) throw new Error('the editor did not render in the frame');
    await expect(doc.querySelector('[data-testid="img"] [contenteditable]')).toBeNull();
    await expectCspInForce(frame, doc);

    // The site components' own subtrees, minus nested editors inside them (Lexical and MDXEditor chrome set inline
    // styles). The whole surface sits under contenteditable ancestors, so only those inside a component root count.
    await settle();
    const roots = [...doc.querySelectorAll('[data-testid="spread"], [data-testid="img"]')];
    const rendered = roots.flatMap((root) =>
      [root, ...root.querySelectorAll('*')].filter((element) => {
        const editable = element.closest('[contenteditable]');
        return !editable || !root.contains(editable);
      }),
    );
    await expect(roots.length).toBeGreaterThanOrEqual(2);
    await expect(rendered).toEqual(expect.arrayContaining(roots));
    const attributes = rendered.flatMap((element) => Array.from(element.attributes));
    await expect(attributes.filter((a) => a.name.toLowerCase().startsWith('on')).map((a) => a.name)).toEqual([]);
    await expect(attributes.filter((a) => a.name.toLowerCase() === 'style').map((a) => a.value)).toEqual([]);
    await expect(
      attributes.filter((a) => ['href', 'src'].includes(a.name.toLowerCase()) && scriptScheme.test(a.value)),
    ).toEqual([]);

    // Links (any target), image-map areas, form submits and a submit aimed at a form outside the block are cancelled
    // by the block's capture guard and leave the frame and the editor where they are.
    const frameHref = frame.location.href;
    const parentHref = window.location.href;
    const cancelled: string[] = [];
    for (const type of ['click', 'submit']) {
      doc.addEventListener(type, (event) => cancelled.push(`${event.type}:${event.defaultPrevented}`));
    }
    const activate = [
      doc.querySelector<HTMLElement>('[data-testid="go"][target="_top"]'),
      doc.querySelector<HTMLElement>('[data-testid="go"][target="_parent"]'),
      doc.querySelector<HTMLElement>('[data-testid="maparea"] area'),
      doc.querySelector<HTMLElement>('[data-testid="submit"] button'),
      doc.querySelector<HTMLElement>('[data-testid="outside"]'),
    ];
    /* oxlint-disable no-await-in-loop -- each activation must settle before the next one starts. */
    for (const element of activate) {
      if (!element?.closest('.conloca-fragment-block')) throw new Error('a navigating component did not render');
      cancelled.length = 0;
      element.click();
      await settle();
      await expect(cancelled).toEqual(['click:true']);
      await expect(frameElement?.contentWindow?.location.href).toBe(frameHref);
      await expect(frameElement?.contentDocument).toBe(doc);
      await expect(window.location.href).toBe(parentHref);
    }
    /* oxlint-enable no-await-in-loop */

    // A submit with no click first (requestSubmit) is cancelled by the submit capture alone.
    const form = doc.querySelector<HTMLFormElement>('[data-testid="submit"]');
    if (!form) throw new Error('the submitting component did not render');
    cancelled.length = 0;
    form.requestSubmit();
    await settle();
    await expect(cancelled).toEqual(['submit:true']);
    await expect(frameElement?.contentWindow?.location.href).toBe(frameHref);
    await expect(frameElement?.contentDocument).toBe(doc);

    // Clicking every rendered anchor and focusing every element neither executes nor navigates.
    for (const anchor of doc.querySelectorAll<HTMLElement>('a')) anchor.click();
    for (const element of doc.querySelectorAll<HTMLElement>('*')) element.focus();
    await settle();
    await expect(fired).toEqual([]);
    await expect(fired.filter((entry) => entry.includes('/api/render'))).toEqual([]);
    await expect(Reflect.get(window, '__pwned')).toBeUndefined();
    await expect(Reflect.get(frame, '__pwned')).toBeUndefined();
    await expect(frameElement?.contentWindow?.location.href).toBe(frameHref);
    await expect(frameElement?.contentDocument).toBe(doc);
    await expect(window.location.href).toBe(parentHref);
  },
};
