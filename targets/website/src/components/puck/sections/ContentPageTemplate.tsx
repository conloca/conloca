import type { ComponentConfig, ComponentData } from '@puckeditor/core';

type TemplateType = 'standard' | 'legal' | 'landing' | 'about' | 'pricing' | 'contact' | 'blogListing';

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
  landing: {
    label: 'Landing Page',
    description: 'Marketing page with hero, features, social proof, and CTA',
    components: () => [
      createComponent('Hero', {
        variant: 'product',
        badgeText: '',
        title: 'Your headline here',
        description: 'A compelling description of your value proposition.',
        buttons: [
          { id: 'btn-1', label: 'Get Started', href: '#', variant: 'primary' },
          { id: 'btn-2', label: 'Learn More', href: '#features', variant: 'secondary' },
        ],
        imageUrl: '',
        imageAlt: '',
      }),
      createComponent('LogoCloud', {
        title: 'Trusted by teams worldwide',
        logos: [],
        tone: 'subtle',
      }),
      createComponent('FeatureCards', {
        label: 'Features',
        title: 'Everything you need',
        subtitle: 'Key features that set you apart.',
        columns: '3',
        cards: [
          {
            id: crypto.randomUUID(),
            iconSvgPath: 'M13 10V3L4 14h7v7l9-11h-7z',
            title: 'Feature One',
            description: 'Description of your first key feature.',
          },
          {
            id: crypto.randomUUID(),
            iconSvgPath:
              'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
            title: 'Feature Two',
            description: 'Description of your second key feature.',
          },
          {
            id: crypto.randomUUID(),
            iconSvgPath:
              'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
            title: 'Feature Three',
            description: 'Description of your third key feature.',
          },
        ],
      }),
      createComponent('Stats', {
        label: '',
        title: '',
        subtitle: '',
        columns: '4',
        tone: 'brand',
        items: [
          { id: crypto.randomUUID(), value: '10K+', label: 'Users', description: '' },
          { id: crypto.randomUUID(), value: '99.9%', label: 'Uptime', description: '' },
          { id: crypto.randomUUID(), value: '50+', label: 'Features', description: '' },
          { id: crypto.randomUUID(), value: '24/7', label: 'Support', description: '' },
        ],
      }),
      createComponent('Testimonials', {
        label: '',
        title: 'What people are saying',
        subtitle: '',
        columns: '3',
        items: [],
      }),
      createComponent('CTABanner', {
        badgeText: '',
        title: 'Ready to get started?',
        subtitle: 'Try it free — no credit card required.',
        buttons: [{ id: 'cta-1', label: 'Start Free Trial', href: '#', variant: 'primary' }],
      }),
    ],
  },
  about: {
    label: 'About Page',
    description: 'Company or team page with story, team, and stats',
    components: () => [
      createComponent('ContentPageHero', {
        title: 'About Us',
        subtitle: 'Our story, mission, and the people behind the product.',
        breadcrumbs: [
          { id: 'crumb-1', label: 'Home', href: '/' },
          { id: 'crumb-2', label: 'About', href: '#' },
        ],
        tone: 'default',
      }),
      createComponent('ProseSection', {
        label: 'Our Story',
        title: 'Why we built this',
        subtitle: '',
        codeSnippet: '',
        codeFilename: '',
        accentColor: '',
        body: 'Tell your story here. What problem did you set out to solve? What drives your team?',
        width: 'default',
        tone: 'transparent',
      }),
      createComponent('Stats', {
        label: '',
        title: '',
        subtitle: '',
        columns: '3',
        tone: 'subtle',
        items: [
          { id: crypto.randomUUID(), value: '2024', label: 'Founded', description: '' },
          { id: crypto.randomUUID(), value: '10+', label: 'Team Members', description: '' },
          { id: crypto.randomUUID(), value: '1000+', label: 'Happy Users', description: '' },
        ],
      }),
      createComponent('TeamGrid', {
        label: 'Team',
        title: 'Meet the team',
        subtitle: '',
        columns: '3',
        members: [],
      }),
      createComponent('CTABanner', {
        badgeText: '',
        title: 'Want to join us?',
        subtitle: "We're always looking for talented people.",
        buttons: [{ id: 'cta-1', label: 'View Open Positions', href: '#', variant: 'primary' }],
      }),
    ],
  },
  pricing: {
    label: 'Pricing Page',
    description: 'Pricing tiers with FAQ',
    components: () => [
      createComponent('ContentPageHero', {
        title: 'Pricing',
        subtitle: 'Simple, transparent pricing for every team size.',
        breadcrumbs: [
          { id: 'crumb-1', label: 'Home', href: '/' },
          { id: 'crumb-2', label: 'Pricing', href: '#' },
        ],
        tone: 'default',
      }),
      createComponent('PricingTable', {
        label: '',
        title: '',
        subtitle: '',
        tiers: [],
      }),
      createComponent('FAQ', {
        label: '',
        title: 'Frequently Asked Questions',
        subtitle: '',
        items: [
          {
            id: crypto.randomUUID(),
            question: 'Can I change plans later?',
            answer: 'Yes, you can upgrade or downgrade at any time.',
          },
          {
            id: crypto.randomUUID(),
            question: 'Is there a free trial?',
            answer: 'Yes, all paid plans include a 14-day free trial.',
          },
        ],
        ctaText: '',
        ctaButtons: [],
      }),
      createComponent('CTABanner', {
        badgeText: '',
        title: 'Still have questions?',
        subtitle: "We're here to help.",
        buttons: [{ id: 'cta-1', label: 'Contact Sales', href: '/contact', variant: 'primary' }],
      }),
    ],
  },
  contact: {
    label: 'Contact Page',
    description: 'Contact information and channels',
    components: () => [
      createComponent('ContentPageHero', {
        title: 'Contact Us',
        subtitle: "We'd love to hear from you. Reach out through any of the channels below.",
        breadcrumbs: [
          { id: 'crumb-1', label: 'Home', href: '/' },
          { id: 'crumb-2', label: 'Contact', href: '#' },
        ],
        tone: 'default',
      }),
      createComponent('ContactSection', {
        label: '',
        title: '',
        subtitle: '',
        channels: [],
        ctaText: '',
        ctaButtons: [],
      }),
      createComponent('FAQ', {
        label: '',
        title: 'Common Questions',
        subtitle: '',
        items: [
          {
            id: crypto.randomUUID(),
            question: 'What is the typical response time?',
            answer: 'We aim to respond within 24 hours on business days.',
          },
        ],
        ctaText: '',
        ctaButtons: [],
      }),
    ],
  },
  blogListing: {
    label: 'Blog Listing',
    description: 'Blog index page with post grid',
    components: () => [
      createComponent('ContentPageHero', {
        title: 'Blog',
        subtitle: 'News, tutorials, and insights from the team.',
        breadcrumbs: [
          { id: 'crumb-1', label: 'Home', href: '/' },
          { id: 'crumb-2', label: 'Blog', href: '#' },
        ],
        tone: 'default',
      }),
      createComponent('PostGrid', {
        label: '',
        title: '',
        subtitle: '',
        columns: '3',
        showImages: 'true',
        posts: [],
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
  resolvePermissions: (_data, { appState }) => {
    const count = appState.data.content.filter((item) => item.type === 'ContentPageTemplate').length;
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
