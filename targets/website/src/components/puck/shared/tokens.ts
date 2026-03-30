/**
 * Design System Tokens — conloca.com
 *
 * Static palette values (brand, surface) use hex for broad compatibility.
 * Semantic tokens (bg, text, border) use CSS custom properties from global.css
 * so they automatically respond to light/dark theme via [data-theme="dark"].
 */
import type { CSSProperties } from 'react';

export const colors = {
  brand: {
    50: '#ecfeff',
    100: '#cffafe',
    200: '#a5f3fc',
    300: '#67e8f9',
    400: '#22d3ee',
    500: '#06b6d4',
    600: '#0891b2',
    700: '#0e7490',
    800: '#155e75',
    900: '#164e63',
    950: '#083344',
  },
  surface: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
    950: '#020617',
  },
  white: '#ffffff',
  black: '#000000',
  /** Semantic background tokens (theme-aware via CSS custom properties) */
  bg: {
    primary: 'var(--color-bg-primary)',
    secondary: 'var(--color-bg-secondary)',
    card: 'var(--color-bg-card)',
    cardHover: 'var(--color-bg-card-hover)',
    code: 'var(--color-bg-code)',
  },
  /** Semantic text tokens (theme-aware via CSS custom properties) */
  text: {
    primary: 'var(--color-text-primary)',
    secondary: 'var(--color-text-secondary)',
    heading: 'var(--color-text-heading)',
    code: 'var(--color-text-code)',
  },
  /** Semantic border tokens (theme-aware via CSS custom properties) */
  border: {
    primary: 'var(--color-border)',
    hover: 'var(--color-border-hover)',
  },
  /** Badge color variants */
  badge: {
    brand: {
      bg: '#ecfeff',
      text: '#06b6d4',
      border: '#a5f3fc',
    },
    green: {
      bg: '#ecfdf5',
      text: '#10b981',
      border: '#a7f3d0',
    },
    gray: {
      bg: '#f1f5f9',
      text: '#64748b',
      border: '#e2e8f0',
    },
  },
  /** Interactive (button) color tokens */
  interactive: {
    primary: {
      bg: '#06b6d4',
      text: '#020617',
    },
    secondary: {
      bg: 'var(--color-interactive-secondary-bg)',
      text: 'var(--color-interactive-secondary-text)',
      border: 'var(--color-interactive-secondary-border)',
    },
  },
};

export const typography = {
  fonts: {
    body: "'Inter', system-ui, -apple-system, sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', monospace",
  },
  display: {
    '2xl': { fontSize: '72px', lineHeight: '90px' },
    xl: { fontSize: '60px', lineHeight: '72px' },
    lg: { fontSize: '48px', lineHeight: '60px' },
    md: { fontSize: '36px', lineHeight: '44px' },
    sm: { fontSize: '30px', lineHeight: '38px' },
    xs: { fontSize: '24px', lineHeight: '32px' },
  },
  text: {
    xl: { fontSize: '20px', lineHeight: '28px' },
    lg: { fontSize: '18px', lineHeight: '28px' },
    md: { fontSize: '16px', lineHeight: '24px' },
    sm: { fontSize: '14px', lineHeight: '20px' },
    xs: { fontSize: '12px', lineHeight: '18px' },
  },
  weights: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
};

export const spacing = {
  xs: '4px',
  sm: '6px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  '2xl': '20px',
  '3xl': '24px',
  '4xl': '32px',
  '5xl': '40px',
  '6xl': '48px',
  '7xl': '64px',
};

export const radius = {
  sm: '6px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  '2xl': '20px',
  full: '9999px',
};

export const shadows = {
  sm: '0 0 6px 0 rgba(0, 0, 0, 0.08)',
  md: '0 0 8px 0 rgba(0, 0, 0, 0.08)',
  lg: '0 0 12px 0 rgba(0, 0, 0, 0.08)',
  xl: '0 4px 24px 0 rgba(0, 0, 0, 0.10)',
};

export const sectionSpacing = {
  desktop: {
    sm: { paddingY: '48px' },
    md: { paddingY: '96px' },
    lg: { paddingY: '128px' },
  },
  tablet: {
    sm: { paddingY: '32px' },
    md: { paddingY: '64px' },
    lg: { paddingY: '96px' },
  },
  mobile: {
    sm: { paddingY: '24px' },
    md: { paddingY: '48px' },
    lg: { paddingY: '64px' },
  },
};

export const containerPadding = {
  desktop: '32px',
  tablet: '24px',
  mobile: '16px',
};

export const buttonSpacing = {
  sm: { paddingX: '16px', paddingY: '8px' },
  md: { paddingX: '20px', paddingY: '10px' },
  lg: { paddingX: '24px', paddingY: '12px' },
};

export const layout = {
  content: {
    default: '1152px',
    narrow: '896px',
    wide: '1280px',
  },
};

/** Helper to create a display typography style object */
export const displayStyle = (
  size: keyof typeof typography.display,
  weight: keyof typeof typography.weights,
): CSSProperties => ({
  fontFamily: typography.fonts.body,
  fontSize: typography.display[size].fontSize,
  lineHeight: typography.display[size].lineHeight,
  fontWeight: typography.weights[weight],
});

/** Helper to create a body text typography style object */
export const textStyle = (
  size: keyof typeof typography.text,
  weight: keyof typeof typography.weights,
): CSSProperties => ({
  fontFamily: typography.fonts.body,
  fontSize: typography.text[size].fontSize,
  lineHeight: typography.text[size].lineHeight,
  fontWeight: typography.weights[weight],
});
