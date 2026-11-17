import type { LocalizedEntry } from '@conloca/content-api-client';
import { defineFragmentComponents, evaluateMDXToComponent } from '@conloca/mdx/render';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ComponentProps, createElement, type ReactNode } from 'react';
import { expect, waitFor } from 'storybook/test';
import { setSiteRender } from '../../site-render.js';
import { CspFrame, expectCspInForce, fired, hostileMdx, restores } from './csp-frame-harness.js';
import { MDXContent } from './MDXContent.js';

/**
 * A fragment rendered inline the way the canvas renders it: portaled into a srcdoc frame (as Puck does) whose meta CSP
 * is the editor page's own. Each hostile case must render inert, and the frame must stay where it is when its links,
 * image-map areas and forms are activated.
 */

const entry: LocalizedEntry = {
  id: 'hostile-fragment',
  type: 'mdx',
  kind: 'fragment',
  site: 'default',
  collection: 'fragments',
  localized: {
    locale: 'en',
    etag: 'v1',
    created: '2026-11-17T00:00:00.000Z',
    modified: '2026-11-17T00:00:00.000Z',
    meta: { title: 'Hostile fragment' },
    content: { mdx: hostileMdx },
  },
};

interface CalloutProps {
  children?: ReactNode;
  data?: object;
  onClick?: string;
}

interface CardProps {
  children?: ReactNode;
  link?: string;
  cta?: { href?: string };
  items?: string[];
}

// Each component echoes what it received, so a value the gate missed would show in the frame.
const vocabulary = defineFragmentComponents({
  components: {
    Callout: ({ children, data, onClick }: CalloutProps) =>
      createElement(
        'aside',
        { className: 'story-callout', 'data-handler': onClick },
        children,
        JSON.stringify(data ?? null),
      ),
    Card: ({ children, link, cta, items = [] }: CardProps) =>
      createElement(
        'div',
        null,
        children,
        ...[link, cta?.href, ...items].map((s, i) => createElement('a', { key: i, href: s }, s)),
      ),
    Spread: (props: ComponentProps<'div'>) => createElement('div', props),
  },
  elements: {
    a: (props: ComponentProps<'a'>) => createElement('a', { ...props, className: 'site-link' }),
  },
});

function InlineFrame() {
  return (
    <CspFrame>
      <MDXContent entry={entry} />
    </CspFrame>
  );
}

const meta = {
  title: 'Puck/MDXContent',
  component: InlineFrame,
  beforeEach: () => {
    fired.length = 0;
    setSiteRender({ evaluate: evaluateMDXToComponent, vocabulary });
    return () => {
      for (const restore of restores.splice(0)) restore();
      setSiteRender({});
    };
  },
} satisfies Meta<typeof InlineFrame>;

export default meta;

type Story = StoryObj<typeof meta>;

const settle = () => new Promise((resolve) => window.setTimeout(resolve, 300));

export const HostileFragmentInlineCannotExecute: Story = {
  play: async ({ canvasElement }) => {
    const frameElement = canvasElement.querySelector<HTMLIFrameElement>('iframe[title="Canvas"]');
    await waitFor(() => expect(frameElement?.contentDocument?.querySelector('.story-callout')).toBeTruthy(), {
      timeout: 5000,
    });
    const frame = frameElement?.contentWindow;
    const doc = frameElement?.contentDocument;
    const root = doc?.querySelector('[data-conloca-content-root]');
    if (!frame || !doc || !root) throw new Error('the fragment did not render in the frame');

    // Positive control: the editor-page CSP is in force in the frame the fragment renders in.
    await expectCspInForce(frame, doc);

    // Hostile MDX renders inert.
    await settle();
    await expect(fired).toEqual([]);
    await expect(Reflect.get(window, '__pwned')).toBeUndefined();
    await expect(Reflect.get(frame, '__pwned')).toBeUndefined();
    await expect(root.querySelectorAll('script, iframe, [style]')).toHaveLength(0);
    const attributes = [...root.querySelectorAll('*')].flatMap((element) => Array.from(element.attributes));
    await expect(attributes.filter((attribute) => attribute.name.toLowerCase().startsWith('on'))).toEqual([]);
    await expect(attributes.filter((attribute) => attribute.value.includes('url('))).toEqual([]);
    await expect(
      attributes.filter(
        (attribute) =>
          (attribute.name === 'href' || attribute.name === 'src') &&
          /^(javascript|vbscript|data:text\/html)/i.test(attribute.value),
      ),
    ).toEqual([]);
    await expect(root.querySelector('aside.story-callout')?.textContent).toContain('callout');
    await expect(root.textContent).toContain('<script>alert(1)</script>');
    await expect(root.textContent).not.toContain('PWN');

    // Links (any target), image-map areas, form submits and a submit control aimed at a form outside the fragment
    // leave the frame and the editor where they are. Bubble listeners see whether the capture guard cancelled each.
    const cancelled: string[] = [];
    for (const type of ['click', 'submit']) {
      doc.addEventListener(type, (event) => cancelled.push(`${event.type}:${event.defaultPrevented}`));
    }
    const parentHref = window.location.href;
    const frameHref = frame.location.href;
    const activate = [
      root.querySelector<HTMLElement>('a[target="_top"]'),
      root.querySelector<HTMLElement>('a[target="_parent"]'),
      root.querySelector<HTMLElement>('area'),
      root.querySelector<HTMLElement>('button[type="submit"]'),
      root.querySelector<HTMLElement>('button[form="outside"]'),
    ];
    /* oxlint-disable no-await-in-loop -- each activation must settle before the next one starts. */
    for (const element of activate) {
      if (!element) throw new Error(`a navigating element did not render: ${root.innerHTML}`);
      cancelled.length = 0;
      element.click();
      await settle();
      await expect(cancelled).toEqual(['click:true']);
      await expect(frameElement?.contentWindow?.location.href).toBe(frameHref);
      await expect(frameElement?.contentDocument).toBe(doc);
      await expect(window.location.href).toBe(parentHref);
    }
    /* oxlint-enable no-await-in-loop */
    await expect(fired).toEqual([]);
    await expect(Reflect.get(window, '__pwned')).toBeUndefined();
    await expect(Reflect.get(frame, '__pwned')).toBeUndefined();
  },
};
