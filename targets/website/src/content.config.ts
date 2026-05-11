import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { createConlocaCollections } from '@conloca/astro-cms/node/content';

const { collections: conlocaCollections } = await createConlocaCollections({
  contentRoot: './content',
  site: 'default',
});

export const collections = {
  docs: defineCollection({
    /**
     * Conloca's read-repair (commit 597bad0d) injects `id: vx-*` into every
     * doc's frontmatter for content-tracking. Astro's default `glob` slug
     * derivation interacts badly with that `id`, leaving Starlight unable
     * to resolve sidebar entries like `slug: 'getting-started'`. Pin the
     * Astro entry id to the file path (sans extension) so filename-based
     * slugs in `astro.config.mjs` keep working — the Conloca `id` field
     * stays in frontmatter as data.
     */
    loader: docsLoader({
      generateId: ({ entry }) => entry.replace(/\.(md|mdx|markdown|mdown|mkdn|mkd|mdwn|mdoc)$/, ''),
    }),
    schema: docsSchema(),
  }),
  ...conlocaCollections,
};
