import { createPageRenderer } from '@conloca/astro-cms/components';
import config from '../puck.config';

/**
 * Page renderer for this site.
 * Created using the factory function with our Puck config.
 */
export const PageRenderer = createPageRenderer(config);
