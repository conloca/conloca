/**
 * Ambient declarations for side-effect CSS imports used by the
 * editor. The bundler (Vite / tsdown) handles `.css` imports as
 * side-effect injections; TypeScript needs a module declaration
 * to accept the syntax without a "Cannot find module" error.
 *
 * Scoped specifically to the third-party CSS modules we
 * intentionally pull in. A blanket `*.css` declaration would
 * accept any path including typos.
 */
declare module '@mdxeditor/editor/style.css';
