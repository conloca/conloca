/**
 * SPA boot entry.
 *
 * Single boot path: mounts the full CMS SPA (chrome + router + editor)
 * in one React tree. The editor used to live inside a child iframe
 * (`EditorFrame`) with its own React/Lexical realm — that has been
 * removed. Lexical's cross-realm bugs (facebook/lexical#2108, #3534)
 * were fixed in Lexical v0.7.3 (Dec 2022) and the bundled MDXEditor
 * version is well past that; same-window mounting is the documented
 * and supported configuration.
 */
import('./main-spa').then((m) => m.mountSpa());

// Keep TypeScript treating this file as a module so other `declare global`
// blocks in the package merge correctly.
export {};
