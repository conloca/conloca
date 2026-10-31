/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PageConversionFacts } from '../../convert-pages.js';
import { configureUI, setEditorReadOnly, setPageConversion } from '../../ui-config.js';
import { NoPagesYet } from './NoPagesYet.js';

const FACTS: PageConversionFacts = { cliVersion: '0.2.4', site: 'default', routes: ['/', '/pricing', '/x"; rm -rf ~'] };
const NO_ROUTES: PageConversionFacts = { cliVersion: '0.2.4', site: 'default' };
const NOT_LISTED = /doesn't have this site's page list yet/;
let written: string[] = [];
let refuse = false;
beforeEach(() => {
  written = [];
  refuse = false;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        if (refuse) throw new Error('denied');
        written.push(text);
      },
    },
  });
});
afterEach(() => {
  cleanup();
  configureUI({ readOnly: undefined });
});
const renderNoPagesYet = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NoPagesYet onCreatePage={() => {}} />
    </QueryClientProvider>,
  );
const convertButton = (): HTMLElement | null =>
  screen.queryByRole('button', { name: 'Make an existing page editable' });
const copyButton = () => screen.getByRole('button', { name: 'Copy prompt' });
const prompt = () => (screen.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement).value;

describe('No Conloca pages yet', () => {
  it('explains the empty site and offers both actions, without reading as an error', () => {
    configureUI({ hosted: true, pageConversion: FACTS, readOnly: undefined });
    renderNoPagesYet();
    expect(screen.getByRole('heading', { name: 'No Conloca pages yet' })).toBeTruthy();
    expect(convertButton()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create a new page' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('preselects nothing and copies a prompt naming exactly the chosen route', async () => {
    configureUI({ hosted: true, pageConversion: FACTS, readOnly: undefined });
    renderNoPagesYet();
    fireEvent.click(convertButton()!);
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[]).map((box) => box.checked)).toEqual([false, false]);
    expect(screen.queryByText(/rm -rf/)).toBeNull();
    expect(copyButton().hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: '/pricing' }));
    fireEvent.click(copyButton());
    await screen.findByText('Copied');
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('"routes": [\n    "/pricing"\n  ]');
  });

  it('offers the upgrade-first prompt while the route list is unknown', () => {
    configureUI({ hosted: true, pageConversion: NO_ROUTES, readOnly: undefined });
    renderNoPagesYet();
    fireEvent.click(convertButton()!);
    expect(screen.getByText(NOT_LISTED)).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(copyButton().hasAttribute('disabled')).toBe(false);
    expect(prompt()).toContain('`npx @conloca/cli@0.2.4 routes`');
  });

  it('shows the routes once the workspace editor learns them', () => {
    configureUI({ hosted: true, pageConversion: NO_ROUTES, readOnly: undefined });
    renderNoPagesYet();
    fireEvent.click(convertButton()!);
    act(() => setPageConversion(FACTS));
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.queryByText(NOT_LISTED)).toBeNull();
  });

  it('says so when the clipboard refuses, keeping the prompt selectable', async () => {
    refuse = true;
    configureUI({ hosted: true, pageConversion: FACTS, readOnly: undefined });
    renderNoPagesYet();
    fireEvent.click(convertButton()!);
    fireEvent.click(screen.getByRole('checkbox', { name: '/' }));
    fireEvent.click(copyButton());
    await screen.findByText('Copying failed. Select the prompt and copy it yourself.');
    expect(screen.queryByText('Copied')).toBeNull();
    expect(prompt()).toContain('"/"');
  });

  it('shows no actions to an account that may not write, and follows a change of access', () => {
    configureUI({ hosted: true, pageConversion: FACTS, readOnly: { reason: 'View only' } });
    renderNoPagesYet();
    expect(screen.queryByRole('button')).toBeNull();
    act(() => setEditorReadOnly(null));
    expect(convertButton()).toBeTruthy();
  });

  it('offers no conversion without the facts, but still creating a page', () => {
    configureUI({ hosted: true, readOnly: undefined });
    renderNoPagesYet();
    expect(convertButton()).toBeNull();
    expect(screen.getByRole('button', { name: 'Create a new page' })).toBeTruthy();
  });

  it('reads the route list from the dev server in the local editor', async () => {
    const requested: string[] = [];
    const previous = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (url: string | URL | Request) => {
        requested.push(String(url));
        return Response.json({ routes: ['/', '/about', '/x y'] });
      },
      { preconnect: () => {} },
    );
    try {
      configureUI({ pageConversion: { cliVersion: 'latest', site: 'default' }, readOnly: undefined });
      renderNoPagesYet();
      fireEvent.click(await screen.findByRole('button', { name: 'Make an existing page editable' }));
      expect(requested).toEqual(['/__cms/api/static-routes']);
      expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    } finally {
      globalThis.fetch = previous;
    }
  });
});
