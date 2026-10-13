import { mockPuckConfig } from './mock-puck-config.js';
import { setPuckConfig } from './puck-config.js';
import { configureUI } from './ui-config.js';

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

// Install the mock components. The editor reads its config through
// `getPuckConfig()`, so assigning a bare `window.__PUCK_CONFIG__` here — as this
// did — left the dev palette empty.
setPuckConfig(mockPuckConfig);

// Import main synchronously
import './main.js';
