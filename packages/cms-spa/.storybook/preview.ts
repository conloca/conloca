import type { Preview } from '@storybook/react-vite';

// Load-bearing despite being empty: since Storybook 10.3 the vitest addon
// auto-applies these preview annotations, and the story runner fails outright
// when this file is missing (verified). Global decorators/parameters land
// here as stories grow.
const preview: Preview = {};

export default preview;
