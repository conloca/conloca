import '@conloca/cms-spa/styles.css';
import type { Preview } from '@storybook/react-vite';

// Shared production CSS, without booting the SPA or installing app providers.
// The Nx catalog target builds bun-web before resolving this package export.
const preview: Preview = {};

export default preview;
