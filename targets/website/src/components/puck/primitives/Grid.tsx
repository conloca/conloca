import type { ComponentConfig, Slot } from '@puckeditor/core';
import type { WithLayout } from '../../Layout';
import { withLayout } from '../../Layout';
import { Section } from '../../Section';

export type GridProps = WithLayout<{
  numColumns: number;
  gap: number;
  items: Slot;
}>;

const GridInternal: ComponentConfig<GridProps> = {
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
      max: 200,
    },
    items: {
      type: 'slot',
      disallow: [
        'Blockquote',
        'Callout',
        'CodeBlock',
        'ComparisonTable',
        'ContentBlockSection',
        'ContentPageHero',
        'ContentPageTemplate',
        'CTABanner',
        'FAQ',
        'FeatureCards',
        'Hero',
        'HostedComparison',
        'NumberedFlow',
        'RichTextSection',
        'Steps',
      ],
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
            gridTemplateColumns: `repeat(${numColumns}, 1fr)`,
            gap: `${gap}px`,
            width: '100%',
          }}
        />
      </Section>
    );
  },
};

export const Grid = withLayout(GridInternal);
