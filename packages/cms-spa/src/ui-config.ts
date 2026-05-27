import type { ContentAPIClient } from '@conloca/content-api-client';
import type { QueryClientConfig } from '@tanstack/react-query';
import type { ConflictBridge } from './conflict/types';
import type { MediaBridge } from './media/types';

export interface TemplateConfig {
  label: string;
  component: string;
  pathPrefix?: string;
  description?: string;
}

export interface UIConfig {
  basename?: string;
  apiBaseUrl?: string;
  siteBaseUrl?: string; // Base URL for the site (e.g., '/docs' or 'https://example.com/docs')
  enableDevtools?: boolean;
  queryClientOptions?: QueryClientConfig;
  /**
   * Optional content client supplied by an embedding host. When absent,
   * CmsSpaApp creates the default ContentAPIClient from `apiBaseUrl`.
   */
  contentClient?: ContentAPIClient;
  /** Absolute path to project root (for "Open in Editor" links) */
  projectRoot?: string;
  /** Relative path to schemas file (e.g., './src/schemas.ts') */
  schemasPath?: string;
  /** Page creation templates */
  templates?: Record<string, TemplateConfig>;
  /**
   * True when at least one site in `sites.json` declares an `mdxPages`
   * path. Drives whether the create-page dialog exposes the "Document
   * page" (MDX) option. When absent or false, the dialog only creates
   * Puck pages — the historical behavior.
   */
  mdxPagesEnabled?: boolean;
  /**
   * The site's supported locales. Comes from the top-level `locales`
   * option on `conlocaCMS({...})` (which can be derived from
   * `localesFromAstroI18n` / `localesFromStarlight`). When absent the
   * dialog falls back to a single English locale and hides the locale
   * field entirely.
   */
  locales?: { list: string[]; defaultLocale: string };
  /**
   * When true, cms-spa is rendering inside a hosted shell that already
   * owns workspace identity, account, and workspace-state UI. The sidebar
   * suppresses widgets that would compete with the host (UserAvatar,
   * GitStatusPanel) and lets the host's chrome show through. Default
   * false: cms-spa runs as the whole page (astro-cms, dev-entry).
   */
  hosted?: boolean;
  /**
   * Bridge for the host shell's conflict-resolution session. When
   * present, the `/conflicts` route reads and writes through this;
   * the sidebar shows a "Conflicts" entry with a count when a
   * session is active. When absent (local dev / astro-cms standalone),
   * `/conflicts` reports "All clear" and submit/abandon disable —
   * conflict resolution is a hosted-mode surface and there's
   * no plausible mock for it without a host shell.
   */
  conflictBridge?: ConflictBridge;
  /**
   * Bridge the host shell installs to surface hosted-mode media
   * metadata (e.g. branch-vs-published scope) in cms-spa's media
   * surfaces. cms-spa's renderer-neutral `AssetEntry` does NOT
   * carry scope because the local-Astro case has no notion of
   * branch-only assets. Surfaces consult the bridge through a
   * TanStack-wrapped hook (`useAssetScope` in `media/use-asset-scope.ts`)
   * so per-asset lookups cache cleanly.
   *
   * Optional in `UIConfig` — when absent, AssetCard /
   * AssetDetailSidebar skip the scope pill entirely. This keeps
   * astro-cms standalone working unchanged.
   */
  mediaBridge?: MediaBridge;
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
