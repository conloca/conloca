// This file will be loaded by Bun before running tests
import { expect, mock } from 'bun:test';
// Set up DOM environment
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as matchers from '@testing-library/jest-dom/matchers';
import type React from 'react';

// Configure Happy DOM for better test performance
GlobalRegistrator.register();

// Extend Bun's expect with jest-dom matchers
expect.extend(matchers);

// Mock Radix UI Portal to render inline for testing
mock.module('@radix-ui/react-portal', () => ({
  Portal: ({ children }: { children: React.ReactNode }) => children,
}));
