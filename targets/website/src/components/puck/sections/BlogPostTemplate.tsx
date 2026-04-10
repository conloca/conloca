import type { ComponentConfig, ComponentData } from '@puckeditor/core';

type BlogTemplateType = 'standard' | 'tutorial' | 'announcement';

export type BlogPostTemplateProps = {
  template: BlogTemplateType;
  content: ComponentData[];
};

const createComponent = (type: string, props: Record<string, unknown>): ComponentData => ({
  type,
  props: {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ...props,
  },
});

const TEMPLATES: Record<BlogTemplateType, { label: string; description: string; components: () => ComponentData[] }> = {
  standard: {
    label: 'Standard',
    description: 'General blog post with header, body, and CTA',
    components: () => [
      createComponent('ArticleHero', {
        title: 'Blog Post Title',
        subtitle: 'A brief summary of what this post covers.',
        authorName: 'Author Name',
        authorAvatarUrl: '',
        publishDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        readingTime: '5 min read',
        breadcrumbs: [
          { id: 'crumb-1', label: 'Home', href: '/' },
          { id: 'crumb-2', label: 'Blog', href: '/blog/' },
          { id: 'crumb-3', label: 'Post Title', href: '#' },
        ],
      }),
      createComponent('ProseSection', {
        label: '',
        title: '',
        subtitle: '',
        codeSnippet: '',
        codeFilename: '',
        accentColor: '',
        body: 'Write your article content here. Use multiple Prose Sections or other content blocks to structure your post.',
        width: 'narrow',
        tone: 'transparent',
      }),
      createComponent('CTABanner', {
        badgeText: '',
        title: 'Enjoyed this article?',
        subtitle: 'Subscribe to get notified when we publish new content.',
        buttons: [{ id: 'cta-1', label: 'Subscribe', href: '#', variant: 'primary' }],
      }),
    ],
  },
  tutorial: {
    label: 'Tutorial',
    description: 'Step-by-step guide with code examples',
    components: () => [
      createComponent('ArticleHero', {
        title: 'Tutorial: Getting Started',
        subtitle: 'A step-by-step guide to help you get up and running.',
        authorName: 'Author Name',
        authorAvatarUrl: '',
        publishDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        readingTime: '10 min read',
        breadcrumbs: [
          { id: 'crumb-1', label: 'Home', href: '/' },
          { id: 'crumb-2', label: 'Blog', href: '/blog/' },
          { id: 'crumb-3', label: 'Tutorial', href: '#' },
        ],
      }),
      createComponent('ProseSection', {
        label: '',
        title: 'Introduction',
        subtitle: '',
        codeSnippet: '',
        codeFilename: '',
        accentColor: '',
        body: 'Explain what the reader will learn and any prerequisites.',
        width: 'narrow',
        tone: 'transparent',
      }),
      createComponent('ProseSection', {
        label: '',
        title: 'Step 1: Setup',
        subtitle: '',
        codeSnippet: 'bun add @conloca/astro-cms',
        codeFilename: 'terminal',
        accentColor: '',
        body: 'Explain the first step here.',
        width: 'narrow',
        tone: 'transparent',
      }),
      createComponent('ProseSection', {
        label: '',
        title: 'Step 2: Configure',
        subtitle: '',
        codeSnippet: '',
        codeFilename: '',
        accentColor: '',
        body: 'Explain the second step here.',
        width: 'narrow',
        tone: 'transparent',
      }),
      createComponent('Callout', {
        type: 'info',
        title: 'Tip',
        body: 'Add a helpful tip or important note for your readers.',
      }),
      createComponent('CTABanner', {
        badgeText: '',
        title: 'Ready to try it yourself?',
        subtitle: 'Get started with the quick start guide.',
        buttons: [{ id: 'cta-1', label: 'Quick Start', href: '/getting-started/', variant: 'primary' }],
      }),
    ],
  },
  announcement: {
    label: 'Announcement',
    description: 'Product update or release announcement',
    components: () => [
      createComponent('ArticleHero', {
        title: 'Announcing Feature X',
        subtitle: "We're excited to share what we've been working on.",
        authorName: 'Author Name',
        authorAvatarUrl: '',
        publishDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        readingTime: '3 min read',
        breadcrumbs: [
          { id: 'crumb-1', label: 'Home', href: '/' },
          { id: 'crumb-2', label: 'Blog', href: '/blog/' },
          { id: 'crumb-3', label: 'Announcement', href: '#' },
        ],
      }),
      createComponent('ProseSection', {
        label: '',
        title: '',
        subtitle: '',
        codeSnippet: '',
        codeFilename: '',
        accentColor: '',
        body: 'Introduce the announcement and explain what changed.',
        width: 'narrow',
        tone: 'transparent',
      }),
      createComponent('FeatureList', {
        label: '',
        title: "What's New",
        subtitle: '',
        showNumbers: 'false',
        columns: '2',
        items: [
          {
            id: crypto.randomUUID(),
            number: '1',
            iconText: '',
            title: 'Feature One',
            description: 'Description of the first new feature.',
          },
          {
            id: crypto.randomUUID(),
            number: '2',
            iconText: '',
            title: 'Feature Two',
            description: 'Description of the second new feature.',
          },
        ],
        width: 'narrow',
        tone: 'transparent',
      }),
      createComponent('CTABanner', {
        badgeText: '',
        title: 'Try it now',
        subtitle: 'Update to the latest version to get these features.',
        buttons: [{ id: 'cta-1', label: 'Get Started', href: '/getting-started/', variant: 'primary' }],
      }),
    ],
  },
};

type SlotRenderComponent = React.ComponentType<Record<string, never>>;

const BlogPostTemplateComponent = ({
  content: Content,
}: Omit<BlogPostTemplateProps, 'content'> & { content: SlotRenderComponent }) => {
  return <Content />;
};

export const BlogPostTemplate: ComponentConfig<BlogPostTemplateProps> = {
  label: 'Blog Post Template',
  resolvePermissions: (_data, { appState }) => {
    const count = appState.data.content.filter((item) => item.type === 'BlogPostTemplate').length;
    return { duplicate: false, insert: count < 1 };
  },
  fields: {
    template: {
      type: 'select',
      label: 'Choose a Template',
      options: Object.entries(TEMPLATES).map(([value, { label, description }]) => ({
        label: `${label} — ${description}`,
        value,
      })),
    },
    content: {
      type: 'slot',
    },
  },
  defaultProps: {
    template: 'standard',
    content: [],
  },
  resolveData: ({ props }, { changed, trigger }) => {
    const contentEmpty = !props.content || props.content.length === 0;
    const templateChanged = trigger !== 'force' && changed.template;
    const shouldPopulate = templateChanged || contentEmpty;

    if (!shouldPopulate) {
      return { props: {} };
    }

    const templateConfig = TEMPLATES[props.template];
    if (!templateConfig) {
      return { props: {} };
    }

    return {
      props: { content: templateConfig.components() },
    };
  },
  render: BlogPostTemplateComponent as unknown as ComponentConfig<BlogPostTemplateProps>['render'],
};
