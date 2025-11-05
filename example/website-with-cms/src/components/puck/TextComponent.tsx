import React from 'react';

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
