import type { Config } from '@measured/puck';
import { H1 } from './test/h1';

// Define component props types
type Components = {
  h1: {
    text: string;
  };
  p: {
    text: string;
  };
};

// Simple components for testing
const P = ({ text }: { text: string }) => <p>{text ?? 'P'}</p>;

// Use Config<Components> for full type safety
const puckConfig: Config<Components> = {
  components: {
    h1: {
      fields: {
        text: { type: 'text' },
      },
      render: (props) => <H1 text={props.text} />,
    },
    p: {
      fields: {
        text: { type: 'textarea' },
      },
      render: P,
    },
  },
};

export default puckConfig;
