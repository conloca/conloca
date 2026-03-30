import type { ComponentConfig } from '@puckeditor/core';
import type { CSSProperties } from 'react';
import type { WithLayout } from '../../Layout';
import { withLayout } from '../../Layout';
import { Section } from '../../Section';
import { colors, typography } from '../shared/tokens';

export type ImageProps = WithLayout<{
  src: string;
  alt: string;
  caption?: string;
  aspectRatio: 'auto' | '16/9' | '4/3' | '1/1' | '3/4';
  objectFit: 'cover' | 'contain';
  borderRadius: '0' | '8px' | '16px' | '24px' | '9999px';
  maxWidth: 'full' | '800px' | '600px' | '400px';
}>;

const ImageInner: ComponentConfig<ImageProps> = {
  fields: {
    src: {
      type: 'text',
      label: 'Image URL',
    },
    alt: {
      type: 'text',
      label: 'Alt Text',
    },
    caption: {
      type: 'text',
      label: 'Caption (optional)',
    },
    aspectRatio: {
      type: 'select',
      label: 'Aspect Ratio',
      options: [
        { label: 'Auto', value: 'auto' },
        { label: '16:9 (Landscape)', value: '16/9' },
        { label: '4:3 (Standard)', value: '4/3' },
        { label: '1:1 (Square)', value: '1/1' },
        { label: '3:4 (Portrait)', value: '3/4' },
      ],
    },
    objectFit: {
      type: 'radio',
      label: 'Object Fit',
      options: [
        { label: 'Cover', value: 'cover' },
        { label: 'Contain', value: 'contain' },
      ],
    },
    borderRadius: {
      type: 'select',
      label: 'Border Radius',
      options: [
        { label: 'None', value: '0' },
        { label: 'Small (8px)', value: '8px' },
        { label: 'Medium (16px)', value: '16px' },
        { label: 'Large (24px)', value: '24px' },
        { label: 'Full (Circle)', value: '9999px' },
      ],
    },
    maxWidth: {
      type: 'select',
      label: 'Max Width',
      options: [
        { label: 'Full Width', value: 'full' },
        { label: 'Large (800px)', value: '800px' },
        { label: 'Medium (600px)', value: '600px' },
        { label: 'Small (400px)', value: '400px' },
      ],
    },
  },
  defaultProps: {
    src: '',
    alt: '',
    caption: '',
    aspectRatio: 'auto',
    objectFit: 'cover',
    borderRadius: '0',
    maxWidth: 'full',
  },
  render: ({ src, alt, caption, aspectRatio, objectFit, borderRadius, maxWidth }) => {
    const containerStyle: CSSProperties = {
      width: '100%',
      maxWidth: maxWidth === 'full' ? '100%' : maxWidth,
      margin: maxWidth !== 'full' ? '0 auto' : undefined,
    };

    const imageContainerStyle: CSSProperties = {
      position: 'relative',
      width: '100%',
      aspectRatio: aspectRatio === 'auto' ? undefined : aspectRatio,
      backgroundColor: colors.surface[100],
      borderRadius,
      overflow: 'hidden',
    };

    const imageStyle: CSSProperties = {
      width: '100%',
      height: aspectRatio === 'auto' ? 'auto' : '100%',
      objectFit,
      display: 'block',
      borderRadius,
    };

    const placeholderStyle: CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: aspectRatio === 'auto' ? '200px' : '100%',
      backgroundColor: colors.surface[100],
      borderRadius,
      color: colors.surface[400],
      fontSize: typography.text.sm.fontSize,
      textAlign: 'center',
      padding: '16px',
    };

    const captionStyle: CSSProperties = {
      marginTop: '8px',
      fontSize: typography.text.sm.fontSize,
      color: colors.text.secondary,
      textAlign: 'center',
    };

    return (
      <Section>
        <figure style={containerStyle}>
          <div style={imageContainerStyle}>
            {src ? (
              <img src={src} alt={alt || ''} style={imageStyle} loading="lazy" />
            ) : (
              <div style={placeholderStyle}>
                <span>Add image URL in the sidebar</span>
              </div>
            )}
          </div>
          {caption && <figcaption style={captionStyle}>{caption}</figcaption>}
        </figure>
      </Section>
    );
  },
};

export const Image = withLayout(ImageInner);
