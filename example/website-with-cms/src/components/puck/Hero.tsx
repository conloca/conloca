import type { ComponentConfig, Slot } from '@measured/puck';
import type React from 'react';
import type { ReactNode } from 'react';
import { Section } from '../Section';
import { ButtonComponent } from './ButtonComponent';
import { HeadingComponent } from './HeadingComponent';
import { TextComponent } from './TextComponent';

export type HeroProps = {
  quote?: { index: number; label: string };
  title: string | ReactNode;
  description: string;
  align?: string;
  padding: string;
  image?: {
    content?: Slot | unknown;
    mode?: 'inline' | 'background' | 'custom';
    url?: string;
  };
  buttons: {
    label: string;
    href?: string;
    variant?: 'primary' | 'secondary';
  }[];
};

const HeroComponent = (props: HeroProps & { puck: { isEditing: boolean } }) => {
  const { align, title, description, buttons, padding, image, puck } = props;
  const isCenter = align === 'center';
  const ImageContent = image?.mode === 'custom' && image.content ? (image.content as React.ComponentType) : null;

  return (
    <Section
      style={{
        paddingTop: padding,
        paddingBottom: padding,
        position: 'relative',
        ...(image?.mode === 'background' && {
          backgroundImage: `url("${image?.url}")`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          color: '#fff',
        }),
      }}
    >
      {image?.mode === 'background' && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
          }}
        />
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: isCenter ? 'column' : 'row',
          alignItems: 'center',
          gap: '32px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div
          style={{
            flex: 1,
            textAlign: isCenter ? 'center' : 'left',
          }}
        >
          <div style={{ marginBottom: '16px' }}>
            {typeof title === 'string' ? (
              <HeadingComponent text={title} level="1" size="xxxl" align={isCenter ? 'center' : 'left'} />
            ) : (
              <h1
                style={{
                  fontSize: '48px',
                  fontWeight: 700,
                  margin: 0,
                  textAlign: isCenter ? 'center' : 'left',
                }}
              >
                {title}
              </h1>
            )}
          </div>
          <div style={{ marginBottom: '24px', opacity: 0.9 }}>
            <TextComponent text={description} size="m" align={isCenter ? 'center' : 'left'} />
          </div>
          <div
            style={{
              display: 'flex',
              gap: '16px',
              flexWrap: 'wrap',
              justifyContent: isCenter ? 'center' : 'flex-start',
            }}
          >
            {buttons.map((button, i) => (
              <ButtonComponent
                key={i}
                label={button.label}
                href={button.href || '#'}
                variant={button.variant || 'primary'}
                isEditing={puck.isEditing}
                textColor={image?.mode === 'background' ? '#fff' : undefined}
              />
            ))}
          </div>
        </div>

        {!isCenter && image?.mode === 'inline' && image?.url && (
          <div
            style={{
              flex: 1,
              backgroundImage: `url('${image?.url}')`,
              backgroundSize: 'cover',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'center',
              borderRadius: 24,
              height: 356,
              width: '100%',
            }}
          />
        )}

        {!isCenter && ImageContent && (
          <div
            style={{
              flex: 1,
              height: 356,
              width: '100%',
            }}
          >
            <ImageContent />
          </div>
        )}
      </div>
    </Section>
  );
};

export const Hero: ComponentConfig<HeroProps> = {
  fields: {
    title: { type: 'text', contentEditable: true },
    description: { type: 'textarea', contentEditable: true },
    buttons: {
      type: 'array',
      min: 1,
      max: 4,
      getItemSummary: (item) => item.label || 'Button',
      arrayFields: {
        label: { type: 'text', contentEditable: true },
        href: { type: 'text' },
        variant: {
          type: 'select',
          options: [
            { label: 'primary', value: 'primary' },
            { label: 'secondary', value: 'secondary' },
          ],
        },
      },
    },
    align: {
      type: 'radio',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
      ],
    },
    padding: {
      type: 'select',
      options: [
        { label: '64px', value: '64px' },
        { label: '96px', value: '96px' },
        { label: '128px', value: '128px' },
        { label: '160px', value: '160px' },
      ],
    },
    image: {
      type: 'object',
      objectFields: {
        url: { type: 'text' },
        mode: {
          type: 'select',
          options: [
            { label: 'Inline', value: 'inline' },
            { label: 'Background', value: 'background' },
            { label: 'Custom', value: 'custom' },
          ],
        },
      },
    },
  },
  defaultProps: {
    title: 'Hero',
    description: 'Description',
    buttons: [
      {
        label: 'Learn more',
        variant: 'primary',
      },
    ],
    align: 'left',
    padding: '128px',
  },
  render: HeroComponent,
};
