import type { Config } from '@measured/puck';

// Define component props types for mock components
type MockComponents = {
  Hero: {
    title: string;
    subtitle: string;
    backgroundImage?: string;
    ctaText: string;
    ctaLink: string;
  };
  Text: {
    text: string;
    align: 'left' | 'center' | 'right';
  };
  Button: {
    text: string;
    href: string;
  };
};

export const mockPuckConfig: Config<MockComponents> = {
  components: {
    Hero: {
      fields: {
        title: { type: 'text' },
        subtitle: { type: 'text' },
        backgroundImage: { type: 'text', label: 'Background Image URL' },
        ctaText: { type: 'text', label: 'CTA Button Text' },
        ctaLink: { type: 'text', label: 'CTA Button Link' },
      },
      defaultProps: {
        title: 'Welcome to Our Site',
        subtitle: 'Build amazing experiences',
        ctaText: 'Get Started',
        ctaLink: '/signup',
      },
      render: ({ title, subtitle, backgroundImage, ctaText, ctaLink }) => (
        <div
          style={{
            padding: '80px 20px',
            textAlign: 'center',
            background: backgroundImage
              ? `url(${backgroundImage}) center/cover`
              : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white',
          }}
        >
          <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>{title}</h1>
          <p style={{ fontSize: '1.5rem', marginBottom: '2rem' }}>{subtitle}</p>
          <a
            href={ctaLink}
            style={{
              display: 'inline-block',
              padding: '12px 24px',
              background: 'white',
              color: '#667eea',
              borderRadius: '6px',
              textDecoration: 'none',
              fontWeight: 'bold',
            }}
          >
            {ctaText}
          </a>
        </div>
      ),
    },

    Text: {
      fields: {
        text: { type: 'textarea' },
        align: {
          type: 'select',
          options: [
            { label: 'Left', value: 'left' },
            { label: 'Center', value: 'center' },
            { label: 'Right', value: 'right' },
          ],
        },
      },
      defaultProps: {
        text: 'Enter your text here',
        align: 'left',
      },
      render: ({ text, align }) => <p style={{ textAlign: align }}>{text}</p>,
    },

    Button: {
      fields: {
        text: { type: 'text' },
        href: { type: 'text', label: 'Link URL' },
      },
      defaultProps: {
        text: 'Click me',
        href: '#',
      },
      render: ({ text, href }) => (
        <a
          href={href}
          style={{
            display: 'inline-block',
            padding: '12px 24px',
            background: '#3b82f6',
            color: 'white',
            borderRadius: '6px',
            textDecoration: 'none',
            fontWeight: 'bold',
          }}
        >
          {text}
        </a>
      ),
    },
  },
};
