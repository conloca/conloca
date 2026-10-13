import { conlocaData, conlocaFragments, conlocaPages } from '@conloca/astro-cms/node/content';
import { dataSchemas } from './schemas/data';

export const collections = {
  pages: conlocaPages(),
  ...conlocaData({ dataSchemas }),
  ...conlocaFragments('general'),
};
