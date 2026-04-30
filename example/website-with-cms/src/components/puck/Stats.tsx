import type { ComponentConfig } from '@puckeditor/core';
import { Section } from '../Section';
import { HeadingComponent } from './HeadingComponent';
import { TextComponent } from './TextComponent';

export type StatsProps = {
  items: {
    title: string;
    description: string;
  }[];
};

export const Stats: ComponentConfig<StatsProps> = {
  fields: {
    items: {
      type: 'array',
      getItemSummary: (item, i) => item.title || `Feature #${i}`,
      defaultItemProps: {
        title: 'Stat',
        description: '1,000',
      },
      arrayFields: {
        title: {
          type: 'text',
          contentEditable: true,
        },
        description: {
          type: 'text',
          contentEditable: true,
        },
      },
    },
  },
  defaultProps: {
    items: [
      {
        title: 'Stat',
        description: '1,000',
      },
    ],
  },
  render: ({ items }) => {
    return (
      <Section className="puck-stats" maxWidth={'916px'}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${items.length}, 1fr)`,
            gap: '24px',
            padding: '48px 0',
          }}
        >
          {items.map((item) => (
            <div
              key={`${item.title}:${item.description}`}
              style={{
                textAlign: 'center',
              }}
            >
              <div style={{ marginBottom: '8px' }}>
                <HeadingComponent text={item.description} level="2" size="xl" align="center" />
              </div>
              <TextComponent text={item.title} size="s" color="muted" align="center" />
            </div>
          ))}
        </div>
      </Section>
    );
  },
};
