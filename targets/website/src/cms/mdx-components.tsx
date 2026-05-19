// Host-curated MDX content the CMS toolbar/slash menu can insert.
//
// As of the auto-discover registry (`/__cms/api/registry`), the CMS
// learns about JSX components by scanning MDX content + the
// configured local component folder — no hand-written descriptors
// here. This file is now only for **markdown snippets**: pure-MDX
// boilerplate (headings, callouts, comparison tables) the CMS UI
// inserts at the cursor. Snippets aren't typed JSX so auto-discover
// doesn't infer them; they remain host-curated.

import { defineMdxComponents, type MdxSnippetDescriptor } from '@conloca/astro-cms';

/** `category: 'Patterns'` groups them as a single section in the
 * toolbar dropdown, visually apart from typed components. */
const SNIPPET_CATEGORY = 'Patterns';

export const sectionHeadingSnippet: MdxSnippetDescriptor = {
  name: 'snippet-section-heading',
  kind: 'snippet',
  insert: { label: 'Section Heading', category: SNIPPET_CATEGORY },
  content: '## Section title\n\nWrite the opening paragraph for this section here.\n',
};

export const calloutQuoteSnippet: MdxSnippetDescriptor = {
  name: 'snippet-callout-quote',
  kind: 'snippet',
  insert: { label: 'Callout Quote', category: SNIPPET_CATEGORY },
  content: '> A short, sharp takeaway or highlighted recommendation.\n',
};

export const proofPointsSnippet: MdxSnippetDescriptor = {
  name: 'snippet-proof-points',
  kind: 'snippet',
  insert: { label: 'Proof Points', category: SNIPPET_CATEGORY },
  content: '- Clear editorial workflow\n- Reusable narrative blocks\n- Git-native publishing history\n',
};

export const comparisonTableSnippet: MdxSnippetDescriptor = {
  name: 'snippet-comparison-table',
  kind: 'snippet',
  insert: { label: 'Comparison Table', category: SNIPPET_CATEGORY },
  content:
    '| Option | Best for | Tradeoff |\n| --- | --- | --- |\n| Option A | Teams that want speed | Less flexibility |\n| Option B | Teams that need control | More setup |\n',
};

export const beforeAfterSnippet: MdxSnippetDescriptor = {
  name: 'snippet-before-after',
  kind: 'snippet',
  insert: { label: 'Before / After Table', category: SNIPPET_CATEGORY },
  content:
    '| Before | After |\n| --- | --- |\n| Editors wait on developers | Editors publish with reusable blocks |\n| Content lives in tools | Content lives in the repo |\n',
};

export const nextStepsSnippet: MdxSnippetDescriptor = {
  name: 'snippet-next-steps',
  kind: 'snippet',
  insert: { label: 'Next Steps List', category: SNIPPET_CATEGORY },
  content: '## Next steps\n\n1. First action\n2. Second action\n3. Third action\n',
};

export const codeCalloutSnippet: MdxSnippetDescriptor = {
  name: 'snippet-code-callout',
  kind: 'snippet',
  insert: { label: 'Code Callout', category: SNIPPET_CATEGORY },
  content: '```ts\nconlocaCMS({\n  contentRoot: "./content",\n  puckConfigPath: "./src/puck.config.tsx",\n})\n```\n',
};

export const mdxComponents = defineMdxComponents([
  sectionHeadingSnippet,
  calloutQuoteSnippet,
  proofPointsSnippet,
  comparisonTableSnippet,
  beforeAfterSnippet,
  nextStepsSnippet,
  codeCalloutSnippet,
]);
