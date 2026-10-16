/**
 * Synthetic collection every discovered fragment lands in (the loader flattens
 * all fragment collections into one). A leaf module on purpose: the render core
 * must stay free of the `astro:content` that `collections.ts` pulls in, and the
 * content config that `collections.ts` runs in must not load the render core's
 * Puck and React graph just to name a collection. Both re-export it.
 */
export const ALL_FRAGMENTS_COLLECTION = '__conloca_fragments';
