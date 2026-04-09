import type { ComponentConfig, ComponentData } from '@puckeditor/core';

type TemplateType = 'standard' | 'legal';

export type ContentPageTemplateProps = {
  template: TemplateType;
  content: ComponentData[];
};

const createComponent = (type: string, props: Record<string, unknown>): ComponentData => ({
  type,
  props: {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ...props,
  },
});

const TEMPLATES: Record<TemplateType, { label: string; description: string; components: () => ComponentData[] }> = {
  standard: {
    label: 'Standard',
    description: 'General content page with sections and call-to-action',
    components: () => [
      createComponent('ContentPageHero', {
        title: 'Page Title',
        subtitle: 'A brief description of this page.',
        breadcrumbs: [
          { id: 'crumb-1', label: 'Home', href: '/' },
          { id: 'crumb-2', label: 'Page Title', href: '#' },
        ],
        tone: 'default',
      }),
      createComponent('ContentBlockSection', {
        title: 'Introduction',
        subtitle: '',
        label: '',
        blockId: '',
        width: 'default',
        tone: 'transparent',
        startsNewSection: 'true',
      }),
      createComponent('ContentBlockSection', {
        title: 'Details',
        subtitle: '',
        label: '',
        blockId: '',
        width: 'default',
        tone: 'transparent',
        startsNewSection: 'true',
      }),
      createComponent('CTABanner', {
        badgeText: '',
        title: 'Questions?',
        subtitle: 'Get in touch with our team.',
        buttons: [{ id: 'cta-1', label: 'Contact Us', href: '/contact', variant: 'primary' }],
      }),
    ],
  },
  legal: {
    label: 'Legal / Policy',
    description: 'Terms, privacy policy, and legal documents',
    components: () => [
      createComponent('ContentPageHero', {
        title: 'Terms and Conditions',
        subtitle: '',
        breadcrumbs: [
          { id: 'crumb-1', label: 'Home', href: '/' },
          { id: 'crumb-2', label: 'Legal', href: '#' },
          { id: 'crumb-3', label: 'Terms and Conditions', href: '#' },
        ],
        tone: 'subtle',
      }),
      createComponent('ContentBlockSection', {
        title: 'Introduction',
        subtitle: '',
        label: '',
        blockId: '',
        width: 'narrow',
        tone: 'transparent',
        startsNewSection: 'true',
      }),
      createComponent('ContentBlockSection', {
        title: 'Terms of Use',
        subtitle: '',
        label: '',
        blockId: '',
        width: 'narrow',
        tone: 'transparent',
        startsNewSection: 'true',
      }),
      createComponent('Callout', {
        type: 'note',
        title: 'Last Updated',
        body: 'This document was last updated on [date]. We reserve the right to update these terms at any time.',
      }),
      createComponent('ContentBlockSection', {
        title: 'Contact',
        subtitle: '',
        label: '',
        blockId: '',
        width: 'narrow',
        tone: 'transparent',
        startsNewSection: 'true',
      }),
      createComponent('CTABanner', {
        badgeText: '',
        title: 'Have questions about our policies?',
        subtitle: 'Our team is happy to help.',
        buttons: [{ id: 'cta-1', label: 'Contact Us', href: '/contact', variant: 'primary' }],
      }),
    ],
  },
};

type SlotRenderComponent = React.ComponentType<Record<string, never>>;

const ContentPageTemplateComponent = ({
  content: Content,
}: Omit<ContentPageTemplateProps, 'content'> & { content: SlotRenderComponent }) => {
  return <Content />;
};

export const ContentPageTemplate: ComponentConfig<ContentPageTemplateProps> = {
  label: 'Content Page Template',
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

    // When trigger is 'force' (SSR/resolveAllData), Puck's cold resolver cache
    // makes ALL props appear as changed. Only populate when content is truly empty.
    // When trigger is not 'force' (user interaction), honor changed.template
    // so switching the template dropdown repopulates content.
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
  render: ContentPageTemplateComponent as unknown as ComponentConfig<ContentPageTemplateProps>['render'],
};
