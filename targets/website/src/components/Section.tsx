import type { CSSProperties } from 'react';
import { forwardRef, type ReactNode } from 'react';

export type SectionProps = {
  className?: string;
  children: ReactNode;
  maxWidth?: string;
  style?: CSSProperties;
};

export const Section = forwardRef<HTMLDivElement, SectionProps>(
  ({ children, className, maxWidth = '1152px', style = {} }, ref) => {
    return (
      <div
        className={className}
        ref={ref}
        style={{
          width: '100%',
          boxSizing: 'border-box',
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
