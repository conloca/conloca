// Page-settings schemas for the Conloca CMS metadata dialog.
//
// All pages live in the `pages` collection regardless of format; `type`
// distinguishes puck pages from mdx pages. The Starlight-shaped schema
// below applies to every mdx page on the site, so we key it on `type:mdx`.

import { definePageSchema } from '@conloca/astro-cms';
import { z } from 'zod';

export { mdxComponents } from './cms/mdx-components';

const BADGE_VARIANTS = [
  { value: 'default', label: 'Default' },
  { value: 'note', label: 'Note' },
  { value: 'tip', label: 'Tip' },
  { value: 'caution', label: 'Caution' },
  { value: 'danger', label: 'Danger' },
  { value: 'success', label: 'Success' },
] as const;

const TEMPLATE_OPTIONS = [
  { value: 'doc', label: 'Doc (default)' },
  { value: 'splash', label: 'Splash landing' },
] as const;

const starlightZod = z.object({
  title: z.string(),
  description: z.string().max(160).optional(),
  template: z.enum(['doc', 'splash']).optional(),
  draft: z.boolean().optional(),
  pagefind: z.boolean().optional(),
  editUrl: z.union([z.string().url(), z.boolean()]).optional(),
  sidebar: z
    .object({
      label: z.string().optional(),
      order: z.number().optional(),
      hidden: z.boolean().optional(),
      badge: z
        .union([
          z.string(),
          z.object({
            text: z.string(),
            variant: z.enum(['default', 'note', 'tip', 'caution', 'danger', 'success']),
          }),
        ])
        .optional(),
    })
    .optional(),
});

export const pageSchemas = {
  'type:mdx': definePageSchema({
    label: 'Starlight page',
    schema: starlightZod,
    ui: {
      title: { control: 'text', group: 'basics', required: true },
      description: { control: 'textarea', group: 'basics', help: '150–160 chars for SEO' },
      template: { control: 'select', group: 'layout', options: TEMPLATE_OPTIONS },
      draft: { control: 'switch', group: 'publishing', help: 'Hide from production builds' },
      pagefind: { control: 'switch', group: 'publishing', label: 'Indexed in search' },
      editUrl: {
        control: 'variant',
        group: 'layout',
        label: 'Edit URL',
        variants: [
          { id: 'default', label: 'Use default', value: undefined },
          { id: 'hidden', label: 'Hide link', value: false },
          { id: 'custom', label: 'Custom URL', control: 'url' },
        ],
      },
      'sidebar.label': { control: 'text', group: 'sidebar' },
      'sidebar.order': { control: 'number', group: 'sidebar' },
      'sidebar.hidden': { control: 'switch', group: 'sidebar' },
      'sidebar.badge': {
        control: 'variant',
        group: 'sidebar',
        label: 'Badge',
        variants: [
          { id: 'none', label: 'None', value: undefined },
          { id: 'simple', label: 'Plain text', control: 'text' },
          {
            id: 'styled',
            label: 'Text + variant',
            control: 'object',
            fields: {
              text: { control: 'text' },
              variant: { control: 'select', options: BADGE_VARIANTS },
            },
          },
        ],
      },
    },
    groups: [
      { id: 'basics', label: 'Basics' },
      { id: 'sidebar', label: 'Sidebar' },
      { id: 'layout', label: 'Layout' },
      { id: 'publishing', label: 'Publishing' },
    ],
    coreFields: { mode: 'minimal' },
  }),
};
