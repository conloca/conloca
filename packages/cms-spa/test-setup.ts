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
