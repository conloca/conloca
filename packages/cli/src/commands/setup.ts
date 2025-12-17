import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// ============================================================================
// Route Templates
// ============================================================================

function getSlugRouteTemplate(siteName = 'default') {
  return `---
import { createPageRendererWithBlocks } from '@conloca/astro-cms/components';
import { createContentAPI } from '@conloca/content-api/node';
import { evaluateMDXBlocks } from '@conloca/mdx/node';
import config from '../puck.config';

// Enable static site generation
export const prerender = true;

// Types for getStaticPaths props
type PageProps = {
  type: 'page';
  pageId: string;
  locale: string;
};

type RedirectProps = {
  type: 'redirect';
  redirectTo: string;
};

type Props = PageProps | RedirectProps;

// Generate static paths for all pages AND redirects at build time
export async function getStaticPaths() {
  const api = await createContentAPI({ contentRoot: './content' });
  const site = (import.meta.env.SITE_NAME ?? import.meta.env.PUBLIC_SITE_NAME ?? '${siteName}') as string;
  const siteApi = api.getSite(site);

  if (!siteApi) {
    return [];
  }

  // Get all pages for this site
  const pages = Array.from(api.listAllContent({ kind: 'page', site }));
  const paths: Array<{ params: { slug: string | undefined }; props: Props }> = [];

  for (const page of pages) {
    const locales = Object.keys(page.locales);
    const firstLocale = locales[0] || 'en';
    const localizedData = page.locales[firstLocale];

    if (!localizedData) continue;

    const pathname = localizedData.pathname || '/';

    // Convert pathname to slug parameter
    // Root path (/) becomes undefined, other paths remove leading slash
    const slug = pathname === '/' ? undefined : pathname.replace(/^\\//, '');

    // Current pathname → renders page
    paths.push({
      params: { slug },
      props: { type: 'page', pageId: page.id, locale: firstLocale },
    });

    // Previous pathnames → redirects (for SEO-friendly URL changes)
    const previousPathnames = localizedData.previousPathnames || {};
    for (const oldPathname of Object.keys(previousPathnames)) {
      const oldSlug = oldPathname === '/' ? undefined : oldPathname.replace(/^\\//, '');
      paths.push({
        params: { slug: oldSlug },
        props: { type: 'redirect', redirectTo: pathname },
      });
    }
  }

  return paths;
}

// Get props from getStaticPaths
const props = Astro.props as Props;

// Handle redirects (from previousPathnames)
if (props.type === 'redirect') {
  return Astro.redirect(props.redirectTo, 301);
}

// Render page
const { pageId, locale } = props;

let puckData;
let manifest;
let PageRenderer;

try {
  const api = await createContentAPI({ contentRoot: './content' });

  const localized = await api.getLocalized(pageId, locale);
  if (!localized) {
    console.warn(\`[\${pageId}] Failed to get localized content for locale "\${locale}"\`);
    return Astro.redirect('/404');
  }

  puckData = localized.localized.content?.puckData;
  manifest = localized.localized.meta || {};

  // Evaluate all MDX blocks to React components at build time
  const mdxComponents = await evaluateMDXBlocks(api, locale);

  // Create page renderer with MDX components baked in via closure
  PageRenderer = createPageRendererWithBlocks(config, puckData, mdxComponents);
} catch (error) {
  console.error(\`[\${pageId}] Failed to render page:\`, error);
  if (error instanceof Error) {
    console.error(\`  Error message: \${error.message}\`);
    console.error(\`  Stack trace:\`, error.stack);
  }
  return Astro.redirect('/404');
}
---

<!doctype html>
<html lang={locale}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{manifest.title || 'Page'}</title>
  </head>
  <body>
    <PageRenderer />
  </body>
</html>
`;
}

function getContentConfigTemplate(siteName = 'default') {
  // Use short form for defaults, explicit form for custom site
  if (siteName === 'default') {
    return `import { createConlocaCollections } from '@conloca/astro-cms/collections';

// Uses default pages + blocks collections
export const { collections } = await createConlocaCollections();
`;
  }

  return `import { createConlocaCollections } from '@conloca/astro-cms/collections';

// Uses pages + blocks collections for site '${siteName}'
export const { collections } = await createConlocaCollections({
  site: '${siteName}',
});
`;
}

// ============================================================================
// Component Templates
// ============================================================================

const LAYOUT_TEMPLATE = `import type { ComponentConfig, DefaultComponentProps, ObjectField } from '@measured/puck';
import type { CSSProperties } from 'react';
import { forwardRef, type ReactNode } from 'react';

type LayoutFieldProps = {
  padding?: string;
  spanCol?: number;
  spanRow?: number;
  grow?: boolean;
};

export type WithLayout<Props extends DefaultComponentProps> = Props & {
  layout?: LayoutFieldProps;
};

type LayoutProps = WithLayout<{
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}>;

export const layoutField: ObjectField<LayoutFieldProps> = {
  type: 'object',
  objectFields: {
    spanCol: {
      label: 'Grid Columns',
      type: 'number',
      min: 1,
      max: 12,
    },
    spanRow: {
      label: 'Grid Rows',
      type: 'number',
      min: 1,
      max: 12,
    },
    grow: {
      label: 'Flex Grow',
      type: 'radio',
      options: [
        { label: 'true', value: true },
        { label: 'false', value: false },
      ],
    },
    padding: {
      type: 'select',
      label: 'Vertical Padding',
      options: [
        { label: '0px', value: '0px' },
        { label: '8px', value: '8px' },
        { label: '16px', value: '16px' },
        { label: '24px', value: '24px' },
        { label: '32px', value: '32px' },
        { label: '40px', value: '40px' },
        { label: '48px', value: '48px' },
        { label: '56px', value: '56px' },
        { label: '64px', value: '64px' },
        { label: '72px', value: '72px' },
        { label: '80px', value: '80px' },
        { label: '88px', value: '88px' },
        { label: '96px', value: '96px' },
        { label: '104px', value: '104px' },
        { label: '112px', value: '112px' },
        { label: '120px', value: '120px' },
        { label: '128px', value: '128px' },
      ],
    },
  },
};

const Layout = forwardRef<HTMLDivElement, LayoutProps>(({ children, className, layout, style }, ref) => {
  return (
    <div
      className={className}
      ref={ref}
      style={{
        gridColumn: layout?.spanCol ? \`span \${Math.max(Math.min(layout.spanCol, 12), 1)}\` : undefined,
        gridRow: layout?.spanRow ? \`span \${Math.max(Math.min(layout.spanRow, 12), 1)}\` : undefined,
        paddingTop: layout?.padding,
        paddingBottom: layout?.padding,
        flex: layout?.grow ? '1 1 0' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
});

Layout.displayName = 'Layout';

export { Layout };

export function withLayout<ThisComponentConfig extends ComponentConfig<any> = ComponentConfig<any>>(
  componentConfig: ThisComponentConfig,
): ThisComponentConfig {
  return {
    ...componentConfig,
    fields: {
      ...componentConfig.fields,
      layout: layoutField,
    },
    defaultProps: {
      ...componentConfig.defaultProps,
      layout: {
        spanCol: 1,
        spanRow: 1,
        padding: '0px',
        grow: false,
        ...componentConfig.defaultProps?.layout,
      },
    },
    resolveFields: (_, params) => {
      if (params.parent?.type === 'Grid') {
        return {
          ...componentConfig.fields,
          layout: {
            ...layoutField,
            objectFields: {
              spanCol: layoutField.objectFields.spanCol,
              spanRow: layoutField.objectFields.spanRow,
              padding: layoutField.objectFields.padding,
            },
          },
        };
      }
      if (params.parent?.type === 'Flex') {
        return {
          ...componentConfig.fields,
          layout: {
            ...layoutField,
            objectFields: {
              grow: layoutField.objectFields.grow,
              padding: layoutField.objectFields.padding,
            },
          },
        };
      }

      return {
        ...componentConfig.fields,
        layout: {
          ...layoutField,
          objectFields: {
            padding: layoutField.objectFields.padding,
          },
        },
      };
    },
    inline: true,
    render: (props) => (
      <Layout className="puck-layout" layout={props.layout as LayoutFieldProps} ref={props.puck.dragRef}>
        {componentConfig.render(props)}
      </Layout>
    ),
  };
}
`;

const SECTION_TEMPLATE = `import type { CSSProperties } from 'react';
import { forwardRef, type ReactNode } from 'react';

export type SectionProps = {
  className?: string;
  children: ReactNode;
  maxWidth?: string;
  style?: CSSProperties;
};

export const Section = forwardRef<HTMLDivElement, SectionProps>(
  ({ children, className, maxWidth = '1280px', style = {} }, ref) => {
    return (
      <div
        className={className}
        ref={ref}
        style={{
          width: '100%',
          marginLeft: 'auto',
          marginRight: 'auto',
          paddingLeft: '24px',
          paddingRight: '24px',
          ...style,
        }}
      >
        <div style={{ maxWidth, margin: '0 auto' }}>{children}</div>
      </div>
    );
  },
);

Section.displayName = 'Section';
`;

const HEADING_COMPONENT_TEMPLATE = `import type React from 'react';

export type HeadingComponentProps = {
  text: string;
  level?: '1' | '2' | '3' | '4' | '5' | '6';
  size?: 'xxxl' | 'xxl' | 'xl' | 'l' | 'm' | 's' | 'xs';
  align?: 'left' | 'center' | 'right';
};

const sizeMap: Record<string, string> = {
  xxxl: '48px',
  xxl: '40px',
  xl: '32px',
  l: '28px',
  m: '24px',
  s: '20px',
  xs: '16px',
};

export function HeadingComponent({ text, level = '2', size = 'm', align = 'left' }: HeadingComponentProps) {
  const HeadingTag = \`h\${level}\` as React.ElementType;
  const fontSize = sizeMap[size] || '24px';

  return (
    <HeadingTag
      style={{
        display: 'block',
        textAlign: align,
        width: '100%',
        fontSize,
        margin: 0,
        fontWeight: 700,
        lineHeight: 1.2,
      }}
    >
      {text}
    </HeadingTag>
  );
}
`;

const HEADING_TEMPLATE = `import type { ComponentConfig } from '@measured/puck';
import React from 'react';
import type { WithLayout } from '../Layout';
import { withLayout } from '../Layout';
import { Section } from '../Section';
import { HeadingComponent } from './HeadingComponent';

export type HeadingProps = WithLayout<{
  align: 'left' | 'center' | 'right';
  text?: string;
  level?: '1' | '2' | '3' | '4' | '5' | '6';
  size: 'xxxl' | 'xxl' | 'xl' | 'l' | 'm' | 's' | 'xs';
}>;

const sizeOptions = [
  { value: 'xxxl', label: 'XXXL' },
  { value: 'xxl', label: 'XXL' },
  { value: 'xl', label: 'XL' },
  { value: 'l', label: 'L' },
  { value: 'm', label: 'M' },
  { value: 's', label: 'S' },
  { value: 'xs', label: 'XS' },
];

const levelOptions = [
  { label: '1', value: '1' },
  { label: '2', value: '2' },
  { label: '3', value: '3' },
  { label: '4', value: '4' },
  { label: '5', value: '5' },
  { label: '6', value: '6' },
];

const HeadingInternal: ComponentConfig<HeadingProps> = {
  fields: {
    text: {
      type: 'textarea',
      contentEditable: true,
    },
    size: {
      type: 'select',
      options: sizeOptions,
    },
    level: {
      type: 'select',
      options: levelOptions,
    },
    align: {
      type: 'radio',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
  },
  defaultProps: {
    align: 'left',
    text: 'Heading',
    size: 'm',
    level: '2',
    layout: {
      padding: '8px',
    },
  },
  render: ({ align, text, size, level = '2' }) => {
    return (
      <Section>
        <HeadingComponent text={text || ''} level={level} size={size} align={align} />
      </Section>
    );
  },
};

export const Heading = withLayout(HeadingInternal);
`;

const TEXT_COMPONENT_TEMPLATE = `import React from 'react';

export type TextComponentProps = {
  text: string;
  size?: 's' | 'm';
  color?: 'default' | 'muted';
  align?: 'left' | 'center' | 'right';
};

export function TextComponent({ text, size = 'm', color = 'default', align = 'left' }: TextComponentProps) {
  return (
    <span
      style={{
        color: color === 'default' ? 'inherit' : '#6b7280',
        display: 'flex',
        textAlign: align,
        width: '100%',
        fontSize: size === 'm' ? '20px' : '16px',
        fontWeight: 300,
        justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
        lineHeight: 1.6,
      }}
    >
      {text}
    </span>
  );
}
`;

const TEXT_TEMPLATE = `import type { ComponentConfig } from '@measured/puck';
import React from 'react';
import type { WithLayout } from '../Layout';
import { withLayout } from '../Layout';
import { Section } from '../Section';
import { TextComponent } from './TextComponent';

export type TextProps = WithLayout<{
  align: 'left' | 'center' | 'right';
  text?: string;
  padding?: string;
  size?: 's' | 'm';
  color: 'default' | 'muted';
  maxWidth?: string;
}>;

const TextInner: ComponentConfig<TextProps> = {
  fields: {
    text: {
      type: 'textarea',
      contentEditable: true,
    },
    size: {
      type: 'select',
      options: [
        { label: 'S', value: 's' },
        { label: 'M', value: 'm' },
      ],
    },
    align: {
      type: 'radio',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
    color: {
      type: 'radio',
      options: [
        { label: 'Default', value: 'default' },
        { label: 'Muted', value: 'muted' },
      ],
    },
    maxWidth: { type: 'text' },
  },
  defaultProps: {
    align: 'left',
    text: 'Text',
    size: 'm',
    color: 'default',
  },
  render: ({ align, color, text, size, maxWidth }) => {
    return (
      <Section maxWidth={maxWidth}>
        <div style={{ maxWidth }}>
          <TextComponent text={text || ''} size={size} color={color} align={align} />
        </div>
      </Section>
    );
  },
};

export const Text = withLayout(TextInner);
`;

const FLEX_TEMPLATE = `import type { ComponentConfig, Slot } from '@measured/puck';
import React from 'react';
import type { WithLayout } from '../Layout';
import { withLayout } from '../Layout';
import { Section } from '../Section';

export type FlexProps = WithLayout<{
  justifyContent: 'start' | 'center' | 'end';
  direction: 'row' | 'column';
  gap: number;
  wrap: 'wrap' | 'nowrap';
  items: Slot;
}>;

const FlexInternal: ComponentConfig<FlexProps> = {
  fields: {
    direction: {
      label: 'Direction',
      type: 'radio',
      options: [
        { label: 'Row', value: 'row' },
        { label: 'Column', value: 'column' },
      ],
    },
    justifyContent: {
      label: 'Justify Content',
      type: 'radio',
      options: [
        { label: 'Start', value: 'start' },
        { label: 'Center', value: 'center' },
        { label: 'End', value: 'end' },
      ],
    },
    gap: {
      label: 'Gap',
      type: 'number',
      min: 0,
    },
    wrap: {
      label: 'Wrap',
      type: 'radio',
      options: [
        { label: 'true', value: 'wrap' },
        { label: 'false', value: 'nowrap' },
      ],
    },
    items: {
      type: 'slot',
    },
  },
  defaultProps: {
    justifyContent: 'start',
    direction: 'row',
    gap: 24,
    wrap: 'wrap',
    layout: {
      grow: true,
    },
    items: [],
  },
  render: ({ justifyContent, direction, gap, wrap, items: Items }) => {
    const justifyContentMap: Record<string, string> = {
      start: 'flex-start',
      center: 'center',
      end: 'flex-end',
    };

    return (
      <Section style={{ height: '100%' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: justifyContentMap[justifyContent] || 'flex-start',
            flexDirection: direction,
            gap,
            flexWrap: wrap,
          }}
        >
          <Items />
        </div>
      </Section>
    );
  },
};

export const Flex = withLayout(FlexInternal);
`;

const GRID_TEMPLATE = `import type { ComponentConfig, Slot } from '@measured/puck';
import React from 'react';
import { withLayout } from '../Layout';
import { Section } from '../Section';

export type GridProps = {
  numColumns: number;
  gap: number;
  items: Slot;
};

export const GridInternal: ComponentConfig<GridProps> = {
  fields: {
    numColumns: {
      type: 'number',
      label: 'Number of columns',
      min: 1,
      max: 12,
    },
    gap: {
      label: 'Gap',
      type: 'number',
      min: 0,
    },
    items: {
      type: 'slot',
    },
  },
  defaultProps: {
    numColumns: 4,
    gap: 24,
    items: [],
  },
  render: ({ gap, numColumns, items: Items }) => {
    return (
      <Section>
        <Items
          style={{
            display: 'grid',
            gridTemplateColumns: \`repeat(\${numColumns}, 1fr)\`,
            gap: \`\${gap}px\`,
            width: '100%',
          }}
        />
      </Section>
    );
  },
};

export const Grid = withLayout(GridInternal);
`;

// ============================================================================
// Config Templates
// ============================================================================

const PUCK_CONFIG_TEMPLATE = `import type { Config } from '@measured/puck';
import type { FlexProps } from './components/puck/Flex';
import { Flex } from './components/puck/Flex';
import type { GridProps } from './components/puck/Grid';
import { Grid } from './components/puck/Grid';
import type { HeadingProps } from './components/puck/Heading';
import { Heading } from './components/puck/Heading';
import type { TextProps } from './components/puck/Text';
import { Text } from './components/puck/Text';

// Define component types
type Components = {
  Grid: GridProps;
  Heading: HeadingProps;
  Flex: FlexProps;
  Text: TextProps;
};

// Puck configuration with full type safety
const puckConfig: Config<Components> = {
  categories: {
    layout: {
      components: ['Grid', 'Flex'],
    },
    typography: {
      components: ['Heading', 'Text'],
    },
  },
  components: {
    Grid,
    Heading,
    Flex,
    Text,
  },
};

export default puckConfig;
`;

const DATA_SCHEMAS_TEMPLATE = `import { z } from 'zod';

/**
 * Data collection schemas for the CMS.
 *
 * Each key is a collection name (matching folders in content/data/).
 * The CMS auto-generates forms from these Zod schemas.
 *
 * Tips:
 * - Use .describe() to add labels/hints shown in the form
 * - Use .optional() for non-required fields
 * - Supported types: string, number, boolean, date, email, url, arrays
 */
export const dataSchemas = {
  /**
   * Authors collection - blog post authors, team members, etc.
   */
  authors: z.object({
    name: z.string().describe('Full name'),
    bio: z.string().describe('Short biography'),
    avatar: z.string().url().optional().describe('Profile image URL'),
    twitter: z.string().optional().describe('Twitter handle (e.g., @username)'),
    email: z.string().email().optional().describe('Contact email'),
  }),

  /**
   * Settings collection - site configuration, feature flags, etc.
   */
  settings: z.object({
    siteName: z.string().optional().describe('Site name'),
    contactEmail: z.string().email().optional().describe('Contact email address'),
  }),
};
`;

// ============================================================================
// Setup Command
// ============================================================================

export async function setup(projectPath = '.', siteName = 'default') {
  try {
    const absolutePath = resolve(projectPath);
    const srcDir = join(absolutePath, 'src');

    console.log('Setting up Conloca for Astro...\n');

    // Create directories
    const dirs = [
      join(srcDir, 'pages'),
      join(srcDir, 'components'),
      join(srcDir, 'components', 'puck'),
      join(srcDir, 'schemas'),
    ];

    for (const dir of dirs) {
      await mkdir(dir, { recursive: true });
    }

    // Track what was created vs skipped
    const created: string[] = [];
    const skipped: string[] = [];

    // Helper to write file if it doesn't exist
    async function writeIfNotExists(filePath: string, content: string, description: string) {
      try {
        await readFile(filePath);
        skipped.push(description);
      } catch {
        await writeFile(filePath, content, 'utf-8');
        created.push(description);
      }
    }

    // 1. Route files
    await writeFile(join(srcDir, 'pages', '[...slug].astro'), getSlugRouteTemplate(siteName), 'utf-8');
    created.push('src/pages/[...slug].astro');

    await writeIfNotExists(
      join(srcDir, 'content.config.ts'),
      getContentConfigTemplate(siteName),
      'src/content.config.ts',
    );

    // 2. Core components
    await writeIfNotExists(join(srcDir, 'components', 'Layout.tsx'), LAYOUT_TEMPLATE, 'src/components/Layout.tsx');

    await writeIfNotExists(join(srcDir, 'components', 'Section.tsx'), SECTION_TEMPLATE, 'src/components/Section.tsx');

    // 3. Puck components
    await writeIfNotExists(
      join(srcDir, 'components', 'puck', 'HeadingComponent.tsx'),
      HEADING_COMPONENT_TEMPLATE,
      'src/components/puck/HeadingComponent.tsx',
    );

    await writeIfNotExists(
      join(srcDir, 'components', 'puck', 'Heading.tsx'),
      HEADING_TEMPLATE,
      'src/components/puck/Heading.tsx',
    );

    await writeIfNotExists(
      join(srcDir, 'components', 'puck', 'TextComponent.tsx'),
      TEXT_COMPONENT_TEMPLATE,
      'src/components/puck/TextComponent.tsx',
    );

    await writeIfNotExists(
      join(srcDir, 'components', 'puck', 'Text.tsx'),
      TEXT_TEMPLATE,
      'src/components/puck/Text.tsx',
    );

    await writeIfNotExists(
      join(srcDir, 'components', 'puck', 'Flex.tsx'),
      FLEX_TEMPLATE,
      'src/components/puck/Flex.tsx',
    );

    await writeIfNotExists(
      join(srcDir, 'components', 'puck', 'Grid.tsx'),
      GRID_TEMPLATE,
      'src/components/puck/Grid.tsx',
    );

    // 4. Puck config
    await writeIfNotExists(join(srcDir, 'puck.config.tsx'), PUCK_CONFIG_TEMPLATE, 'src/puck.config.tsx');

    // 5. Data schemas
    await writeIfNotExists(join(srcDir, 'schemas', 'data.ts'), DATA_SCHEMAS_TEMPLATE, 'src/schemas/data.ts');

    // Summary
    console.log('Created:');
    for (const file of created) {
      console.log(`  ✅ ${file}`);
    }

    if (skipped.length > 0) {
      console.log('\nSkipped (already exist):');
      for (const file of skipped) {
        console.log(`  ⏭  ${file}`);
      }
    }

    console.log('\n✨ Astro setup complete!');
    console.log('\nNext steps:');
    console.log('1. Run `conloca init . <site-name>` to create content directory');
    console.log('2. Start your dev server and visit /__cms to edit pages');
    console.log('3. Add more Puck components in src/components/puck/');
  } catch (error) {
    console.error('❌ Error during setup:', error);
    throw error;
  }
}
