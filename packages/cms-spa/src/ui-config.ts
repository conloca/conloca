import type { QueryClientConfig } from '@tanstack/react-query';

export interface UIConfig {
  basename?: string;
  apiBaseUrl?: string;
  siteBaseUrl?: string; // Base URL for the site (e.g., '/docs' or 'https://example.com/docs')
  enableDevtools?: boolean;
  queryClientOptions?: QueryClientConfig;
}

const defaultConfig: UIConfig = {
  basename: '/__cms',
  apiBaseUrl: '/__cms/api',
  siteBaseUrl: '', // No base URL by default (site at root)
  enableDevtools: false,
  queryClientOptions: {
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5, // 5 minutes
        retry: 1,
      },
    },
  },
};

let config: UIConfig = { ...defaultConfig };

export function configureUI(options: Partial<UIConfig>) {
  config = { ...defaultConfig, ...options };

  // Make it available globally for the runtime
  if (typeof window !== 'undefined') {
    (window as any).__UI_CONFIG__ = config;
  }
}

export function getUIConfig(): UIConfig {
  if (typeof window === 'undefined') {
    return config;
  }

  // Check if already configured via global
  if ((window as any).__UI_CONFIG__) {
    return (window as any).__UI_CONFIG__;
  }

  // For development mode, auto-configure
  if (window.location.pathname === '/') {
    return {
      ...defaultConfig,
      basename: undefined,
      enableDevtools: true,
    };
  }

  return config;
}

// Export for Astro plugin to use
if (typeof window !== 'undefined') {
  (window as any).configureUI = configureUI;
}
