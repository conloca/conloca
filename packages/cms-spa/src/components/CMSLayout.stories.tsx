import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import '../main.css';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect } from 'storybook/test';
import { ThemeProvider } from '../hooks/useTheme.js';
import { useInjectHostStyles } from '../site-styles.js';
import { configureUI } from '../ui-config.js';
import { CMSLayout } from './CMSLayout.js';

configureUI({ hosted: true });

function EmbeddedLayoutHarness() {
  return (
    <div data-testid="host-body" style={{ height: 320, overflow: 'hidden' }}>
      <ThemeProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<CMSLayout />}>
              <Route
                index
                element={
                  <div style={{ minHeight: 640, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ flex: 1 }} />
                    <button type="button" data-testid="bottom-action">
                      Bottom action
                    </button>
                  </div>
                }
              />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </div>
  );
}

function ScopedHostStylesHarness() {
  useInjectHostStyles(
    'conloca-host-preview',
    [
      [
        ':root{--host-title-size:72px}',
        'html.dark .host-callout{color:rgb(1,2,3)}',
        'h1{font:500 var(--host-title-size)/1 serif!important}',
        'button{padding:0!important;border-radius:0!important}',
        'body{background:rgb(245,245,245)}',
      ].join(''),
    ],
    { scopeSelector: '.conloca-mdx-editor-surround' },
  );

  return (
    <div className="host-app p-4">
      <header className="flex items-center gap-2">
        <h1 className="text-base font-medium" data-testid="admin-title">
          Admin title
        </h1>
        <button className="px-3 py-1.5 rounded" data-testid="admin-button" type="button">
          Cancel
        </button>
      </header>
      <div className="conloca-mdx-editor-surround dark mt-4" data-theme="dark">
        <h1 data-testid="host-title">Host title</h1>
        <button data-testid="host-button" type="button">
          Host button
        </button>
        <div className="host-callout" data-testid="host-callout">
          Callout
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: 'Layout/CMSLayout',
  component: CMSLayout,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CMSLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmbeddedHostKeepsBottomReachable: Story = {
  render: () => React.createElement(EmbeddedLayoutHarness),
  play: ({ canvasElement }) => {
    const hostBody = canvasElement.querySelector<HTMLElement>('[data-testid="host-body"]');
    const main = canvasElement.querySelector<HTMLElement>('main');
    const sidebar = canvasElement.querySelector<HTMLElement>('aside');
    const bottomAction = canvasElement.querySelector<HTMLElement>('[data-testid="bottom-action"]');

    expect(hostBody).not.toBeNull();
    expect(main).not.toBeNull();
    expect(sidebar).not.toBeNull();
    expect(bottomAction).not.toBeNull();
    expect(canvasElement.querySelector('[aria-label^="Theme:"]')).toBeNull();

    main!.scrollTop = main!.scrollHeight;

    const hostBottom = hostBody!.getBoundingClientRect().bottom;
    expect(Math.abs(sidebar!.getBoundingClientRect().bottom - hostBottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(main!.getBoundingClientRect().bottom - hostBottom)).toBeLessThanOrEqual(1);
    expect(bottomAction!.getBoundingClientRect().bottom).toBeLessThanOrEqual(hostBottom);
  },
};

export const HostStylesStayInsideEditorSurface: Story = {
  render: () => React.createElement(ScopedHostStylesHarness),
  play: ({ canvasElement }) => {
    const adminTitle = canvasElement.querySelector<HTMLElement>('[data-testid="admin-title"]');
    const adminButton = canvasElement.querySelector<HTMLElement>('[data-testid="admin-button"]');
    const hostTitle = canvasElement.querySelector<HTMLElement>('[data-testid="host-title"]');
    const hostButton = canvasElement.querySelector<HTMLElement>('[data-testid="host-button"]');
    const hostCallout = canvasElement.querySelector<HTMLElement>('[data-testid="host-callout"]');

    expect(getComputedStyle(adminTitle!).fontSize).toBe('16px');
    expect(getComputedStyle(adminButton!).paddingLeft).toBe('12px');
    expect(getComputedStyle(adminButton!).borderRadius).toBe('4px');
    expect(getComputedStyle(hostTitle!).fontSize).toBe('72px');
    expect(getComputedStyle(hostButton!).paddingLeft).toBe('0px');
    expect(getComputedStyle(hostCallout!).color).toBe('rgb(1, 2, 3)');
  },
};
