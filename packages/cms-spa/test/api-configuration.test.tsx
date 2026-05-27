/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import { configureUI, getUIConfig } from '../src/ui-config';

// Mock fetch globally
const mockFetch = mock();
// Add preconnect method to satisfy TypeScript
(mockFetch as any).preconnect = () => {};
global.fetch = mockFetch as any;

describe('API Configuration', () => {
  beforeEach(() => {
    // Reset window config
    delete (window as any).__UI_CONFIG__;
    delete (window as any).location;
    window.location = {
      pathname: '/__cms/',
    } as any;

    // Reset UI configuration to defaults
    configureUI({});

    // Clear mock
    mockFetch.mockClear();
  });

  afterEach(() => {
    mockFetch.mockClear();
  });

  test('default configuration uses /__cms/api as base URL', () => {
    const config = getUIConfig();
    expect(config.apiBaseUrl).toBe('/__cms/api');
    expect(config.basename).toBe('/__cms');
  });

  test('configureUI updates API base URL', () => {
    configureUI({
      apiBaseUrl: '/__custom/api',
      basename: '/__custom',
    });

    const config = getUIConfig();
    expect(config.apiBaseUrl).toBe('/__custom/api');
    expect(config.basename).toBe('/__custom');
  });

  test('ContentAPIClient uses configured base URL for API calls', async () => {
    const client = new ContentAPIClient({ baseUrl: '/__cms/api' });

    // Mock a successful response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'test-content',
        type: 'puck',
        kind: 'page',
        collection: 'pages',
        locales: {},
      }),
    });

    // Make a test API call
    await client.getContent('test-content');

    // Verify the correct URL was called
    expect(mockFetch).toHaveBeenCalledWith('/__cms/api/content/test-content');
  });

  test('ContentAPIClient uses custom base URL when configured', async () => {
    const client = new ContentAPIClient({ baseUrl: '/__custom/api' });
    setContentAPIClient(client);

    // Mock responses
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [], total: 0 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sites: {}, globalLocales: [] }),
      });

    // Make different types of API calls
    await client.listAllContent();
    await client.getSitesConfig();

    // Verify the correct URLs were called (first argument is the URL)
    expect(mockFetch.mock.calls[0][0]).toBe('/__custom/api/content');
    expect(mockFetch.mock.calls[1][0]).toBe('/__custom/api/sites');
  });

  test('custom content client is opt-in and does not change the default client path', () => {
    expect(getUIConfig().contentClient).toBeUndefined();

    const client = new ContentAPIClient({ baseUrl: '/__saas/api' });
    configureUI({ contentClient: client });

    expect(getUIConfig().contentClient).toBe(client);
    expect(getUIConfig().apiBaseUrl).toBe('/__cms/api');
  });

  test('ContentAPIClient handles different API endpoints correctly', async () => {
    const client = new ContentAPIClient({ baseUrl: '/__cms/api' });

    // Mock successful responses for different endpoints
    mockFetch.mockImplementation((url) => {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => {
          if (url.includes('/sites/')) {
            return { items: [], total: 0 };
          }
          if (url.includes('/blocks')) {
            return { items: [], total: 0 };
          }
          if (url.includes('/content/')) {
            return null;
          }
          return {};
        },
      });
    });

    // Test various API methods
    await client.getSitePages('default', 'en');
    await client.getBlocks('shared', 'en');
    await client.isPathnameAvailable('default', '/test-page');

    // Verify URLs include the correct base path
    const calls = mockFetch.mock.calls.map((call) => call[0]);
    expect(calls[0]).toBe('/__cms/api/default/pages?locale=en');
    expect(calls[1]).toBe('/__cms/api/blocks?collection=shared&locale=en');
    expect(calls[2]).toBe('/__cms/api/default/pathname-available?pathname=%2Ftest-page');
  });

  test('development mode configuration', () => {
    // Clear the global config to test the auto-configuration logic
    delete (window as any).__UI_CONFIG__;
    window.location.pathname = '/';

    const config = getUIConfig();
    expect(config.basename).toBeUndefined();
    expect(config.enableDevtools).toBe(true);
    expect(config.siteBaseUrl).toBe(''); // Should still have default siteBaseUrl
  });

  test('siteBaseUrl configuration works', () => {
    configureUI({
      siteBaseUrl: '/docs',
    });

    const config = getUIConfig();
    expect(config.siteBaseUrl).toBe('/docs');

    // Test absolute URL configuration
    configureUI({
      siteBaseUrl: 'https://example.com/docs',
    });

    const config2 = getUIConfig();
    expect(config2.siteBaseUrl).toBe('https://example.com/docs');
  });

  test('default siteBaseUrl is empty string', () => {
    const config = getUIConfig();
    expect(config.siteBaseUrl).toBe('');
  });
});
