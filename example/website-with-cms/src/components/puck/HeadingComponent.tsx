import type React from 'react';

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
  const HeadingTag = `h${level}` as React.ElementType;
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
