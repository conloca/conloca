export const SITE_NAME = 'Conloca';
export const SITE_TITLE = 'Conloca CMS';
export const SITE_URL = 'https://conloca.com';
export const SITE_DESCRIPTION =
  'Visual editing for marketers, full git ownership for developers. File-based CMS powered by Puck with drag-and-drop components.';
export const DEFAULT_ROBOTS = 'index, follow';
export const DEFAULT_OG_IMAGE_PATH = '/social-card.png';
export const DEFAULT_OG_IMAGE_URL = `${SITE_URL}${DEFAULT_OG_IMAGE_PATH}`;
export const SITE_LOGO_URL = `${SITE_URL}/favicon.svg`;

export function resolveSiteUrl(pathname: string): string {
  return new URL(pathname, SITE_URL).toString();
}

export function createOrganizationSchema() {
  return {
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: SITE_LOGO_URL,
    sameAs: ['https://github.com/conloca/conloca'],
  };
}

export function createWebsiteSchema() {
  return {
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    description: 'The file-based CMS that lives in your git repo. Visual editing for Astro websites.',
  };
}

export function createWebPageSchema({
  title,
  description,
  url,
  type = 'WebPage',
}: {
  title: string;
  description: string;
  url: string;
  type?: 'TechArticle' | 'WebPage';
}) {
  return {
    '@type': type,
    name: title,
    headline: title,
    description,
    url,
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: SITE_URL,
    },
    about: {
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
    },
  };
}

export function createFAQPageSchema(items: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}

export function createComparePageSchema(opts: { title: string; description: string; url: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: opts.title,
    description: opts.description,
    about: { '@type': 'SoftwareApplication', name: 'Conloca' },
    mentions: [
      {
        '@type': 'SoftwareApplication',
        name: 'Storyblok',
        applicationCategory: 'DeveloperApplication',
        applicationSubCategory: 'Content Management System',
        description: 'Cloud-hosted headless CMS with visual editor. Paid with free tier.',
      },
      {
        '@type': 'SoftwareApplication',
        name: 'Contentful',
        applicationCategory: 'DeveloperApplication',
        applicationSubCategory: 'Content Management System',
        description: 'Cloud-hosted API-first headless CMS. Paid with free tier.',
      },
      {
        '@type': 'SoftwareApplication',
        name: 'Decap CMS',
        applicationCategory: 'DeveloperApplication',
        applicationSubCategory: 'Content Management System',
        description: 'Open-source git-based CMS with markdown editing UI.',
      },
      {
        '@type': 'SoftwareApplication',
        name: 'Tina CMS',
        applicationCategory: 'DeveloperApplication',
        applicationSubCategory: 'Content Management System',
        description: 'Open-source git-based CMS with inline visual editing and cloud sync option.',
      },
    ],
  };
}
