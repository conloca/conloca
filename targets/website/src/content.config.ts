import { defineCollection } from 'astro:content';
import { createConlocaCollections } from '@conloca/astro-cms/collections';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

const { collections: conlocaCollections } = await createConlocaCollections({
  contentRoot: './content',
  site: 'default',
});

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  ...conlocaCollections,
};
