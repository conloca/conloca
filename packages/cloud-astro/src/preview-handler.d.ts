/**
 * Types for the `./preview-handler` export, the `.astro` route the preview build injects. Astro compiles and renders
 * it and nothing imports it, so this declares only the default export every Astro component has.
 */
declare const PreviewHandler: (props: Record<string, unknown>) => unknown;
export default PreviewHandler;
