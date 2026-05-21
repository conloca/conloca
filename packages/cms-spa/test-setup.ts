// This file will be loaded by Bun before running tests
import { expect, mock } from 'bun:test';
// Set up DOM environment
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as matchers from '@testing-library/jest-dom/matchers';
import React from 'react';

// Configure Happy DOM for better test performance
GlobalRegistrator.register();

// Extend Bun's expect with jest-dom matchers
expect.extend(matchers);

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
  Puck: ({ data, headerTitle, overrides }: { data: any; headerTitle?: string; overrides?: Record<string, any> }) =>
    React.createElement(
      'div',
      { 'data-testid': 'mock-puck-editor' },
      headerTitle ? React.createElement('h1', undefined, headerTitle) : null,
      overrides?.headerActions
        ? React.createElement('div', { 'data-testid': 'mock-puck-header-actions' }, overrides.headerActions())
        : null,
      React.createElement('pre', { 'data-testid': 'mock-puck-data' }, JSON.stringify(data ?? {})),
    ),
  resolveAllData: async (data: unknown) => data,
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
