/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly CONLOCA_CONTENT_ROOT: string;
  readonly CONLOCA_CANVAS_DIR: string;
  readonly CONLOCA_CMS_ROUTE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Virtual module for passing config from plugin to route handler
declare module 'virtual:conloca-config' {
  import type { UIConfig } from '@conloca/cms-spa';
  interface SpaConfig extends UIConfig {
    dataSchemasPath?: string;
    projectRoot?: string;
  }
  const config: SpaConfig;
  export default config;
}
