import { describe, expect, test } from 'bun:test';
import { buildSiteUrl, extractPathFromUrl } from '../src/lib/utils';
import { configureUI, getUIConfig } from '../src/ui-config';

describe('Site Base URL', () => {
  describe('buildSiteUrl', () => {
    test('returns path as-is when no base URL configured', () => {
      configureUI({ siteBaseUrl: '' });
      expect(buildSiteUrl('/about')).toBe('/about');
      expect(buildSiteUrl('about')).toBe('about');
    });

    test('handles relative base URLs', () => {
      configureUI({ siteBaseUrl: '/docs' });
      expect(buildSiteUrl('/about')).toBe('/docs/about');
      expect(buildSiteUrl('about')).toBe('/docs/about');
      expect(buildSiteUrl('/')).toBe('/docs/');
    });

    test('handles absolute base URLs', () => {
      configureUI({ siteBaseUrl: 'https://example.com/docs' });
      expect(buildSiteUrl('/about')).toBe('https://example.com/docs/about');
      expect(buildSiteUrl('about')).toBe('https://example.com/docs/about');
      expect(buildSiteUrl('/')).toBe('https://example.com/docs/');
    });

    test('handles trailing slashes in base URL', () => {
      configureUI({ siteBaseUrl: '/docs/' });
      expect(buildSiteUrl('/about')).toBe('/docs/about');

      configureUI({ siteBaseUrl: 'https://example.com/docs/' });
      expect(buildSiteUrl('/about')).toBe('https://example.com/docs/about');
    });

    test('handles missing leading slash in base URL', () => {
      configureUI({ siteBaseUrl: 'docs' });
      expect(buildSiteUrl('/about')).toBe('/docs/about');
    });
  });

  describe('extractPathFromUrl', () => {
    test('returns URL as-is when no base URL configured', () => {
      configureUI({ siteBaseUrl: '' });
      expect(extractPathFromUrl('/about')).toBe('/about');
      expect(extractPathFromUrl('/docs/about')).toBe('/docs/about');
    });

    test('removes relative base URL', () => {
      configureUI({ siteBaseUrl: '/docs' });
      expect(extractPathFromUrl('/docs/about')).toBe('/about');
      expect(extractPathFromUrl('/docs')).toBe('/');
      expect(extractPathFromUrl('/other')).toBe('/other'); // Doesn't match prefix
    });

    test('removes absolute base URL', () => {
      configureUI({ siteBaseUrl: 'https://example.com/docs' });
      expect(extractPathFromUrl('https://example.com/docs/about')).toBe('/about');
      expect(extractPathFromUrl('https://example.com/docs')).toBe('/');
      expect(extractPathFromUrl('/about')).toBe('/about'); // Doesn't match prefix
    });

    test('handles edge cases', () => {
      configureUI({ siteBaseUrl: '/docs/' });
      expect(extractPathFromUrl('/docs/about')).toBe('/about');

      configureUI({ siteBaseUrl: 'docs' });
      expect(extractPathFromUrl('/docs/about')).toBe('/about');
    });
  });

  describe('Integration with UI Config', () => {
    test('siteBaseUrl is accessible from config', () => {
      configureUI({ siteBaseUrl: '/my-site' });
      const config = getUIConfig();
      expect(config.siteBaseUrl).toBe('/my-site');
    });

    test('defaults to empty string', () => {
      configureUI({});
      const config = getUIConfig();
      expect(config.siteBaseUrl).toBe('');
    });
  });
});
