/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly CONLOCA_CONTENT_ROOT: string;
  readonly CONLOCA_CANVAS_DIR: string;
  readonly CONLOCA_CMS_ROUTE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
