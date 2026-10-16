import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ensureSiteInSitesConfig } from '../lib/sites-config.js';
// Kept as a real .md file so it stays editable markdown; Bun inlines it into
// the bundle.
import CONLOCA_SKILL_TEMPLATE from '../templates/conloca-skill.md' with { type: 'text' };
import { TYPIA_TSCONFIG_TEMPLATE, TYPIA_VITE_TEMPLATE } from '../templates/project-files.js';

/** Site name every other Conloca default assumes for a single-site project. */
export const DEFAULT_SITE_NAME = 'default';

// ============================================================================
// Component Templates
// ============================================================================

const COMPONENT_LAYOUT_TEMPLATE = `import type { ComponentConfig, DefaultComponentProps, ObjectField } from '@puckeditor/core';
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

type ComponentLayoutProps = WithLayout<{
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

const ComponentLayout = forwardRef<HTMLDivElement, ComponentLayoutProps>(
  ({ children, className, layout, style }, ref) => {
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
  },
);

ComponentLayout.displayName = 'ComponentLayout';

export { ComponentLayout };

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
      <ComponentLayout className="puck-layout" layout={props.layout as LayoutFieldProps} ref={props.puck.dragRef}>
        {componentConfig.render(props)}
      </ComponentLayout>
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

const HEADING_TEMPLATE = `import type { ComponentConfig } from '@puckeditor/core';
import React from 'react';
import type { WithLayout } from '../ComponentLayout';
import { withLayout } from '../ComponentLayout';
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

const TEXT_TEMPLATE = `import type { ComponentConfig } from '@puckeditor/core';
import React from 'react';
import type { WithLayout } from '../ComponentLayout';
import { withLayout } from '../ComponentLayout';
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

const FLEX_TEMPLATE = `import type { ComponentConfig, Slot } from '@puckeditor/core';
import React from 'react';
import type { WithLayout } from '../ComponentLayout';
import { withLayout } from '../ComponentLayout';
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

const GRID_TEMPLATE = `import type { ComponentConfig, Slot } from '@puckeditor/core';
import React from 'react';
import { withLayout } from '../ComponentLayout';
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
// Page Layout Template
// ============================================================================

// Bare skeleton on purpose: without a layout the `layout` option has nothing to
// point at and content pages render with no <html>, <head> or styles. It carries
// no styling opinions so it can be replaced wholesale.
const PAGE_LAYOUT_TEMPLATE = `---
interface Props {
  title?: string;
  description?: string;
}

const { title, description } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{title ?? 'My site'}</title>
    {description && <meta name="description" content={description} />}
  </head>
  <body>
    <slot />
  </body>
</html>
`;

// ============================================================================
// Config Templates
// ============================================================================

const PUCK_CONFIG_TEMPLATE = `import type { Config } from '@puckeditor/core';
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

const DATA_SCHEMAS_TEMPLATE = `import { defineHostSchema } from '@conloca/astro-cms/page-schemas';
import typia, { type tags } from 'typia';

/**
 * Data collection schemas for the CMS.
 *
 * Each key is a collection name (matching folders in content/data/). Each value
 * is a TypeScript type plus what Typia generates for it at build time (wired by
 * typia-vite.mjs in astro.config.mjs): \`validate\` checks every stored entry
 * when the collection loads, and \`metadata\` is the JSON Schema the CMS renders
 * the entry form from.
 *
 * Tips:
 * - A JSDoc comment on a field becomes its help text in the form
 * - Optional properties (\`?\`) are optional fields
 * - Supported controls: string, number, boolean, date (\`string & tags.Format<'date-time'>\`),
 *   email / url (\`tags.Format\`), string literal unions (select), arrays
 */

/** Authors collection - blog post authors, team members, etc. */
export interface Author {
  /** Full name */
  name: string;
  /** Short biography */
  bio: string;
  /** Profile image URL */
  avatar?: string & tags.Format<'url'>;
  /** Twitter handle (e.g., @username) */
  twitter?: string;
  /** Contact email */
  email?: string & tags.Format<'email'>;
}

/** Settings collection - site configuration, feature flags, etc. */
export interface Settings {
  /** Site name */
  siteName?: string;
  /** Contact email address */
  contactEmail?: string & tags.Format<'email'>;
}

export const dataSchemas = {
  authors: defineHostSchema<Author>({
    validate: typia.plain.createValidatePrune<Author>(),
    metadata: typia.json.schema<Author>(),
  }),
  settings: defineHostSchema<Settings>({
    validate: typia.plain.createValidatePrune<Settings>(),
    metadata: typia.json.schema<Settings>(),
  }),
};
`;

// ============================================================================
// Setup Command
// ============================================================================

/** Scaffold the Astro-side files into `projectPath`, recording `siteName` in sites.json, and report what was written. */
export async function setup(projectPath = '.', siteName = DEFAULT_SITE_NAME): Promise<string[]> {
  try {
    const absolutePath = resolve(projectPath);
    const srcDir = join(absolutePath, 'src');

    console.log('Setting up Conloca for Astro...\n');

    // Create directories (routes are handled by the integration's routing option)
    const contentDir = join(absolutePath, 'content');
    const dirs = [
      contentDir,
      // The site is registered in sites.json below, and doctor's C4
      // wants every registered site's pages directory on disk.
      join(contentDir, siteName, 'pages'),
      join(srcDir, 'components'),
      join(srcDir, 'components', 'puck'),
      join(srcDir, 'layouts'),
      join(srcDir, 'schemas'),
      join(absolutePath, '.claude', 'skills', 'conloca'),
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

    // 1. Core components
    await writeIfNotExists(
      join(srcDir, 'components', 'ComponentLayout.tsx'),
      COMPONENT_LAYOUT_TEMPLATE,
      'src/components/ComponentLayout.tsx',
    );

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

    // 5. Data schemas, and the native Typia transform that generates their
    // validators and form metadata (astro.config.mjs names typia-vite.mjs).
    await writeIfNotExists(join(srcDir, 'schemas', 'data.ts'), DATA_SCHEMAS_TEMPLATE, 'src/schemas/data.ts');
    await writeIfNotExists(join(absolutePath, 'typia-vite.mjs'), TYPIA_VITE_TEMPLATE, 'typia-vite.mjs');
    await writeIfNotExists(join(absolutePath, 'tsconfig.typia.json'), TYPIA_TSCONFIG_TEMPLATE, 'tsconfig.typia.json');

    // 6. Page layout
    await writeIfNotExists(join(srcDir, 'layouts', 'Layout.astro'), PAGE_LAYOUT_TEMPLATE, 'src/layouts/Layout.astro');

    // 6b. Agent skill — the one-page Conloca guide coding agents load when
    // working on this project.
    await writeIfNotExists(
      join(absolutePath, '.claude', 'skills', 'conloca', 'SKILL.md'),
      CONLOCA_SKILL_TEMPLATE,
      '.claude/skills/conloca/SKILL.md',
    );

    // 7. Sites config. Without it the CMS creates no page collections, which
    // looks exactly like a missing content config: every content page 404s.
    const sites = await ensureSiteInSitesConfig(contentDir, siteName);
    if (sites.added) {
      created.push(sites.existed ? `content/sites.json (added site: ${siteName})` : 'content/sites.json');
    } else {
      skipped.push('content/sites.json');
    }

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

    return created;
  } catch (error) {
    console.error('❌ Error during setup:', error);
    throw error;
  }
}

/** What a human still has to wire by hand after `astro setup`: the astro config, the content config, and the first edit. */
export function printSetupNextSteps(): void {
  console.log('\nNext steps:');
  console.log(`1. content/sites.json now lists the site '${DEFAULT_SITE_NAME}'. To add a second site,`);
  console.log('   run `conloca init . <site-name>`.');
  console.log('\n2. Name the generated files in astro.config.mjs. Nothing loads them until');
  console.log('   they are listed here, and react() must come before conlocaCMS():\n');
  console.log(`     import react from '@astrojs/react';
     import { conlocaCMS } from '@conloca/astro-cms/node';
     import { schemaTypia } from './typia-vite.mjs';

     export default defineConfig({
       integrations: [
         react(),
         conlocaCMS({
           contentRoot: './content',
           puckConfigPath: './src/puck.config.tsx',
           schemasPath: './src/schemas/data.ts',
           layout: './src/layouts/Layout.astro',
         }),
       ],
       vite: { plugins: [...schemaTypia()] },
     });`);
  console.log('\n   The schemas file is generated code: add typia, and ttsc + @ttsc/unplugin as dev');
  console.log('   dependencies, so typia-vite.mjs can compile it.');
  console.log('\n   `layout` on its own turns on a catch-all /[...slug] route over the pages');
  console.log('   collection. Adding `routing` replaces that route, and the top-level `layout`');
  console.log('   is then ignored — name it under routing.routes.<name>.layout instead.');
  console.log('\n3. Create src/content.config.ts. Without it every content page returns 404:\n');
  console.log(`     import { conlocaData, conlocaFragments, conlocaPages } from '@conloca/astro-cms/node/content';
     import { dataSchemas } from './schemas/data';

     export const collections = {
       pages: conlocaPages(),
       ...conlocaData({ dataSchemas }),
       ...conlocaFragments(),
     };`);
  console.log('\n   Every collection is declared here by name — content the config does not name');
  console.log('   fails the build instead of silently not building. The generated schemas file');
  console.log('   already declares its data collections, so they are covered before the first');
  console.log('   entry is saved.');
  console.log('\n4. Start your dev server and visit /__cms to edit pages');
  console.log('5. Add more Puck components in src/components/puck/');
  console.log('6. Working with a coding agent? .claude/skills/conloca/SKILL.md teaches it Conloca');
}
