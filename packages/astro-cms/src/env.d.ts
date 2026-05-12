/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly CONLOCA_CONTENT_ROOT: string;
  readonly CONLOCA_CANVAS_DIR: string;
  readonly CONLOCA_CMS_ROUTE: string;
  // Inlined by Vite `define`: either a JS array literal or `null` when
  // `conlocaCMS({ locales })` is omitted. NOT a JSON string — read it
  // directly with `Array.isArray()`.
  readonly CONLOCA_LOCALES: readonly string[] | null;
  readonly CONLOCA_DEFAULT_LOCALE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Virtual module for passing config from plugin to route handler
declare module 'virtual:conloca-config' {
  import type { UIConfig } from '@conloca/cms-spa';

  interface SpaConfig extends UIConfig {
    schemasPath?: string;
    projectRoot?: string;
  }
  const config: SpaConfig;
  export default config;
}
