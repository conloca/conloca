// This file will be loaded by Bun before running tests
import { afterEach, expect, mock } from 'bun:test';
// Set up DOM environment
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { Data } from '@puckeditor/core';
import React from 'react';

// Configure Happy DOM before importing jest-dom. Its testing-library dependency
// binds `screen` to the global document at module evaluation time.
// Editor and host-style probe tests need browser-like iframe documents;
// Happy DOM 21 disables iframe page loading by default.
GlobalRegistrator.register({ settings: { enableIframePageLoading: true } });
// jest-dom ships one CommonJS-shaped declaration for both conditions, so the
// namespace carries a synthetic `default` that dist/matchers.mjs — the file Bun
// loads — does not, and `expect.extend` rejects it as a matcher.
const { default: _namespaceDefault, ...matchers } = await import('@testing-library/jest-dom/matchers');

// Extend Bun's expect with jest-dom matchers
expect.extend(matchers);

// Testing-library's auto-cleanup does not self-register under bun:test, so a
// file that rendered and skipped its own cleanup() leaked DOM into the shared
// document — `screen` queries then see other files' leftovers, in whatever
// file order the run happened to use (a stale-write suite's Force Save button
// broke an unrelated header test on CI). Clean up after every test, globally;
// per-file cleanup() calls remain harmless duplicates.
const { cleanup } = await import('@testing-library/react');
afterEach(cleanup);

// Mock Radix UI Portal to render inline for testing
mock.module('@radix-ui/react-portal', () => ({
  Portal: ({ children }: { children: React.ReactNode }) => children,
}));

// `@lexical/react/LexicalTypeaheadMenuPlugin` ships a `node` export
// condition that does a top-level `await import(...)` to pick the
// dev/prod bundle. Under Bun's test runner that path lands in a state
// where the React dispatcher reads as null when the menu component
// calls `useCallback`, killing any test that mounts MDXEditor. None of
// our tests actually exercise the slash-menu UI, so stub it out at
// module-load time.
mock.module('@lexical/react/LexicalTypeaheadMenuPlugin', () => ({
  LexicalTypeaheadMenuPlugin: () => null,
  MenuOption: class MenuOption {
    key: string;
    constructor(key: string) {
      this.key = key;
    }
  },
  useBasicTypeaheadTriggerMatch: () => () => null,
}));

mock.module('@puckeditor/core', () => ({
  Puck: ({
    data,
    metadata,
    headerTitle,
    overrides,
    onChange,
  }: {
    data: Data;
    metadata?: object;
    headerTitle?: string;
    overrides?: { headerActions?: () => React.ReactNode };
    onChange?: (data: Data) => void;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'mock-puck-editor' },
      headerTitle ? React.createElement('h1', undefined, headerTitle) : null,
      overrides?.headerActions
        ? React.createElement('div', { 'data-testid': 'mock-puck-header-actions' }, overrides.headerActions())
        : null,
      onChange
        ? React.createElement(
            'button',
            {
              type: 'button',
              'data-testid': 'mock-puck-change',
              onClick: () => onChange({ content: [{ type: 'Test', props: { id: 'changed' } }], root: {}, zones: {} }),
            },
            'Change Puck data',
          )
        : null,
      React.createElement('pre', { 'data-testid': 'mock-puck-data' }, JSON.stringify(data ?? {})),
      React.createElement('pre', { 'data-testid': 'mock-puck-metadata' }, JSON.stringify(metadata ?? {})),
    ),
  registerOverlayPortal: () => undefined,
  resolveAllData: async (data: unknown) => data,
  // The editor reads Puck's state through a selector hook; the mock editor has no blocks and nothing may be inserted.
  createUsePuck:
    () =>
    <Selected>(
      select: (state: { config: { components: object }; getPermissions: () => { insert: boolean } }) => Selected,
    ): Selected =>
      select({ config: { components: {} }, getPermissions: () => ({ insert: false }) }),
  useGetPuck: () => () => ({
    appState: {
      data: {
        content: [],
      },
    },
    dispatch: () => {},
    config: { components: {} },
  }),
}));
