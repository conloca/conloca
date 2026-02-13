import type { ComponentConfig } from '@puckeditor/core';
import type React from 'react';
import type { WithLayout } from '../Layout';
import { withLayout } from '../Layout';
import { HeadingComponent } from './HeadingComponent';
import { TextComponent } from './TextComponent';

export type CardProps = WithLayout<{
  title: string;
  description: string;
  icon?: string;
  mode: 'card' | 'flat';
}>;

const CardInner: ComponentConfig<CardProps> = {
  fields: {
    title: {
      type: 'text',
      contentEditable: true,
    },
    description: {
      type: 'textarea',
      contentEditable: true,
    },
    icon: {
      type: 'select',
      options: [
        { label: 'None', value: '' },
        { label: 'Feather', value: 'Feather' },
        { label: 'Pen Tool', value: 'pen-tool' },
        { label: 'Git Merge', value: 'git-merge' },
        { label: 'GitHub', value: 'github' },
        { label: 'Align Left', value: 'align-left' },
        { label: 'Plug', value: 'plug' },
      ],
    },
    mode: {
      type: 'radio',
      options: [
        { label: 'card', value: 'card' },
        { label: 'flat', value: 'flat' },
      ],
    },
  },
  defaultProps: {
    title: 'Title',
    description: 'Description',
    icon: 'Feather',
    mode: 'card',
  },
  render: ({ title, icon, description, mode }) => {
    const cardStyle: React.CSSProperties = {
      padding: mode === 'card' ? '24px' : '0',
      borderRadius: mode === 'card' ? '8px' : '0',
      border: mode === 'card' ? '1px solid #e5e7eb' : 'none',
      backgroundColor: mode === 'card' ? '#fff' : 'transparent',
      boxShadow: mode === 'card' ? '0 2px 8px rgba(0, 0, 0, 0.1)' : 'none',
      textAlign: mode === 'flat' ? 'center' : 'left',
    };

    const contentStyle: React.CSSProperties = {
      display: 'flex',
      flexDirection: 'column',
      alignItems: mode === 'flat' ? 'center' : 'flex-start',
    };

    return (
      <div style={cardStyle}>
        <div style={contentStyle}>
          {icon && (
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>
              {icon === 'Feather' && '✏'}
              {icon === 'pen-tool' && '✍'}
              {icon === 'git-merge' && '🔀'}
              {icon === 'github' && '💻'}
              {icon === 'align-left' && '📝'}
              {icon === 'plug' && '🔌'}
            </div>
          )}
          <div style={{ marginBottom: '8px' }}>
            <HeadingComponent text={title} level="3" size="m" align={mode === 'flat' ? 'center' : 'left'} />
          </div>
          <TextComponent text={description} size="m" color="muted" align={mode === 'flat' ? 'center' : 'left'} />
        </div>
      </div>
    );
  },
};

export const Card = withLayout(CardInner);
