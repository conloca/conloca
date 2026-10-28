/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { CMSMDXEditor } from '../src/components/editor/CMSMDXEditor.js';
import { setMdxComponents } from '../src/mdx-components.js';
import { configureUI } from '../src/ui-config.js';

// A site may mount the CMS somewhere other than /__cms (the integration's
// `route` option). The editor's own endpoints then live under that route,
// and a request to /__cms finds nothing there.
describe('an editor the site mounts under its own route', () => {
  const realFetch = globalThis.fetch;
  let requested: string[];

  beforeEach(() => {
    requested = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return new Response('', { status: 404 });
    }) as typeof fetch;
    configureUI({ basename: '/admin', apiBaseUrl: '/admin/api' });
    setMdxComponents([{ name: 'Callout', kind: 'flow', import: { from: './src/components/Callout.astro' } }]);
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = realFetch;
    setMdxComponents([]);
    configureUI({});
  });

  function renderEditor(markdown: string) {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <CMSMDXEditor value={markdown} onChange={() => {}} previewRouteUrl="/" />
      </QueryClientProvider>,
    );
  }

  test("asks that route for the page's styles and content wrapper", async () => {
    renderEditor('Hello');

    await waitFor(() => {
      expect(requested).toContain('/admin/api/styles?url=%2F');
      expect(requested).toContain('/admin/api/content-wrapper?url=%2F');
    });
    expect(requested.filter((url) => url.startsWith('/__cms'))).toEqual([]);
  });

  test('asks that route to render a registered component', async () => {
    renderEditor('<Callout>Note</Callout>');

    await waitFor(() => expect(requested).toContain('/admin/api/render'));
    expect(requested.filter((url) => url.startsWith('/__cms'))).toEqual([]);
  });
});

// A parent frame serves a static editor page: the dev-server endpoints for the
// page's styles and content wrapper do not exist there.
describe('an editor inside a parent frame', () => {
  let requested: string[];
  let fetchSpy: Mock<typeof fetch>;

  beforeEach(() => {
    requested = [];
    const answer = async (input: RequestInfo | URL) => {
      requested.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return new Response('', { status: 404 });
    };
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(answer, { preconnect: fetch.preconnect }));
    configureUI({ memoryRouter: { initialPath: '/', onNavigate() {}, subscribe: () => () => {} } });
    setMdxComponents([{ name: 'Callout', kind: 'flow', import: { from: './src/components/Callout.astro' } }]);
  });

  afterEach(() => {
    cleanup();
    fetchSpy.mockRestore();
    setMdxComponents([]);
    configureUI({});
  });

  test('never asks the site for dev-server styles or wrappers', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CMSMDXEditor value="<Callout>Note</Callout>" onChange={() => {}} previewRouteUrl="/" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(requested.some((url) => url.endsWith('/api/render'))).toBe(true));
    expect(requested.filter((url) => url.includes('/api/styles') || url.includes('/api/content-wrapper'))).toEqual([]);
  });
});
