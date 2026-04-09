import type { ComponentConfig, Slot } from '@puckeditor/core';
import type { WithLayout } from '../../Layout';
import { withLayout } from '../../Layout';
import { Section } from '../../Section';

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
      max: 200,
    },
    wrap: {
      label: 'Wrap',
      type: 'radio',
      options: [
        { label: 'Wrap', value: 'wrap' },
        { label: 'No Wrap', value: 'nowrap' },
      ],
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
    justifyContent: 'start',
    direction: 'row',
    gap: 24,
    wrap: 'wrap',
    layout: {
      grow: 'true',
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
          <Items collisionAxis={direction === 'row' ? 'x' : 'y'} />
        </div>
      </Section>
    );
  },
};

export const Flex = withLayout(FlexInternal);
