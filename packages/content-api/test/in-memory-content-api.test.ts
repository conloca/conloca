import { InMemoryContentAPI } from '../src/in-memory-content-api';
import { createContentAPITestSuite } from './content-api.shared-tests';

// Run the shared test suite for InMemoryContentAPI
let api: InMemoryContentAPI;

createContentAPITestSuite(
  'InMemoryContentAPI',
  async () => {
    api = new InMemoryContentAPI({
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
    return api;
  },
  async () => {
    // Clear all content after each test
    api.clear();
  },
);
