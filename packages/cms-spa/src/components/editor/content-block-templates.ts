export interface ContentBlockTemplate {
  id: string;
  label: string;
  description: string;
  category: string;
  content: string;
}

export const contentBlockTemplates: ContentBlockTemplate[] = [
  {
    id: 'long-form',
    label: 'Long-Form Text',
    description: 'Article-style prose for deep explanations, narrative sections, and documentation-style content.',
    category: 'content',
    content:
      '# {{title}}\n\nLead with the most important point in 2-3 sentences. Explain why it matters before diving into the details.\n\n> Editors should understand the value of this section before they finish the first paragraph.\n\n## Key idea\n\nAdd the main explanation here. Use short paragraphs and one list if it helps the reader scan faster.\n\n- First takeaway\n- Second takeaway\n- Third takeaway\n\n## What changes for the team\n\nDescribe the before and after. Focus on clarity, speed, ownership, or workflow quality.\n',
  },
  {
    id: 'feature-narrative',
    label: 'Feature Narrative',
    description:
      'A polished feature story that introduces a capability, explains the workflow, and lands on the user benefit.',
    category: 'features',
    content:
      '# {{title}}\n\nStart with the user problem this block solves and the moment when it becomes obvious they need it.\n\n## Why teams hit this wall\n\nDescribe the friction or limitation in the current workflow. Keep it grounded in real editorial behavior.\n\n## What Conloca changes\n\nExplain the workflow in plain language. Focus on what changes for the editor, not implementation details.\n\n## What it unlocks\n\nClose with the outcome: faster publishing, clearer content operations, fewer bottlenecks, or better site quality.\n\n| Before | After |\n| --- | --- |\n| Manual handoffs | Shared visual workflow |\n| Hidden content state | Git-visible changes |\n',
  },
  {
    id: 'callout-note',
    label: 'Callout Note',
    description: 'Compact supporting content for tips, clarifications, or key reminders inside a larger landing page.',
    category: 'callouts',
    content:
      '## {{title}}\n\n:::note\nLead with a concise note, recommendation, or point of emphasis.\n:::\n\nAdd one short paragraph that gives the reader extra context, guidance, or a best practice.\n\n- Keep the point crisp\n- Explain why it matters\n- Point to the next action\n',
  },
  {
    id: 'comparison-narrative',
    label: 'Comparison Narrative',
    description: 'Structured prose for explaining tradeoffs between Conloca and another category of CMS or workflow.',
    category: 'comparison',
    content:
      '# {{title}}\n\nFrame the choice clearly. What are teams actually choosing between here?\n\n## Where the usual approach breaks\n\nExplain the operational cost, not just the missing feature list.\n\n## Why Conloca feels different\n\nUse this section to connect architecture to daily editing experience.\n\n| Concern | Typical setup | Conloca |\n| --- | --- | --- |\n| Content ownership | External service | Lives in your repo |\n| Editorial UX | Form-heavy | Visual + reusable blocks |\n| Change history | Separate tools | Git-native |\n',
  },
  {
    id: 'founder-note',
    label: 'Founder Note',
    description: 'A more personal voice for opinionated product philosophy, launch notes, or roadmap framing.',
    category: 'story',
    content:
      '# {{title}}\n\nStart with a direct statement of belief. This should sound like a human, not a feature checklist.\n\n## What we kept seeing\n\nDescribe the repeated pattern that convinced you the problem was real.\n\n## What we decided to build instead\n\nExplain the product choice and the philosophy behind it.\n\n> The best CMS should make editors faster without taking the codebase away from developers.\n',
  },
];

export function getContentBlockTemplate(templateId: string | undefined): ContentBlockTemplate | undefined {
  return contentBlockTemplates.find((template) => template.id === templateId);
}

export function renderContentBlockTemplate(templateId: string | undefined, title: string): string {
  const template = getContentBlockTemplate(templateId);
  if (!template) return `# ${title}\n\nWrite your content here.\n`;
  return template.content.split('{{title}}').join(title || 'Untitled Block');
}
