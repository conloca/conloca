import type React from 'react';

export type ButtonComponentProps = {
  label: string;
  href: string;
  variant: 'primary' | 'secondary';
  isEditing?: boolean;
  textColor?: string; // Optional override for text color (e.g., for background images)
};

export function ButtonComponent({ label, href, variant, isEditing = false, textColor }: ButtonComponentProps) {
  const buttonStyle: React.CSSProperties = {
    display: 'inline-block',
    padding: '10px 20px',
    borderRadius: '6px',
    textDecoration: 'none',
    fontWeight: 600,
    cursor: isEditing ? 'default' : 'pointer',
    transition: 'all 0.2s',
    fontSize: '14px',
    boxSizing: 'border-box',
    ...(variant === 'primary'
      ? {
          backgroundColor: '#000',
          color: '#fff',
          border: '2px solid transparent',
        }
      : {
          backgroundColor: 'transparent',
          color: textColor || '#000',
          border: `2px solid ${textColor || '#000'}`,
        }),
  };

  if (isEditing) {
    return <span style={buttonStyle}>{label}</span>;
  }

  return (
    <a href={href} style={buttonStyle} tabIndex={isEditing ? -1 : undefined}>
      {label}
    </a>
  );
}
