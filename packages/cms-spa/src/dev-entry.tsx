import { mockPuckConfig } from './mock-puck-config';
import { configureUI } from './ui-config';

// Configure UI for development - this must happen before main.tsx runs
configureUI({
  basename: '/',
  enableDevtools: true,
  queryClientOptions: {
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5, // 5 minutes
        retry: 1,
      },
    },
  },
});

// Set Puck config
(window as any).__PUCK_CONFIG__ = mockPuckConfig;

// Import main synchronously
import './main';
