import { InMemoryContentAPI } from '../src/in-memory-content-api.js';
import { createContentAPITestSuite } from './content-api.shared-tests.js';

// Run the shared conformance suite against InMemoryContentAPI. The in-memory
// impl serves as the reference backend for the contract: anything that
// passes here must also pass against the filesystem impl.
createContentAPITestSuite('InMemoryContentAPI', async () => {
  const api = new InMemoryContentAPI({
    sites: {
      shop: {
        locales: ['en', 'nl', 'de'],
        defaultLocale: 'en',
        domains: {
          en: 'shop.com',
          nl: 'shop.nl',
          de: 'shop.de',
        },
      },
      corporate: {
        locales: ['en', 'nl'],
        defaultLocale: 'en',
        domains: {
          en: 'corporate.com',
          nl: 'corporate.nl',
        },
      },
    },
    globalLocales: ['en', 'nl', 'de', 'fr', 'es'],
  });

  let counter = 0;
  return {
    api,
    uniq: () => `${Date.now().toString(36)}-${++counter}`,
    cleanup: async () => {
      api.clear();
    },
  };
});
