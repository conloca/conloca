import type { ComponentConfig, Slot } from '@puckeditor/core';
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
          disallow={['Hero', 'Stats']}
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
