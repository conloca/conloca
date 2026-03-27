import { createConlocaCollections } from '@conloca/astro-cms/node/content';

// Uses default pages + blocks collections
export const { collections } = await createConlocaCollections();
