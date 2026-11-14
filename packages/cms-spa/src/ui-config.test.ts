import { afterEach, describe, expect, it } from 'bun:test';
import type { DraftToolsHost } from './draft-tools.js';
import { configureUI, EDITOR_CONFIG_CHANGED_EVENT, getUIConfig, setDataBindings, setTemplates } from './ui-config.js';

describe('configureUI', () => {
  it('refuses draft tools without the site their page refs name', () => {
    const draftTools: DraftToolsHost = {
      listConflicts: async () => [],
      resolveConflict: async () => ({ ok: true }),
      discardPage: async () => ({ ok: true }),
      listVersions: async () => [],
      restoreVersion: async () => ({ ok: true, kept: [] }),
    };
    expect(() => configureUI({ draftTools })).toThrow('draftTools needs siteId');
    expect(getUIConfig().draftTools).toBeUndefined();
  });

  it('notifies the editor once after installing the configuration', () => {
    configureUI({});
    const siteBaseUrl = 'https://example.test/';
    const observedSiteBaseUrls: (string | undefined)[] = [];
    const recordSiteBaseUrl = () => {
      observedSiteBaseUrls.push(getUIConfig().siteBaseUrl);
    };
    window.addEventListener(EDITOR_CONFIG_CHANGED_EVENT, recordSiteBaseUrl);
    try {
      configureUI({ siteBaseUrl });
      expect(observedSiteBaseUrls).toEqual([siteBaseUrl]);
    } finally {
      window.removeEventListener(EDITOR_CONFIG_CHANGED_EVENT, recordSiteBaseUrl);
      configureUI({});
    }
  });
});

/**
 * The `assetsBasePath` field is how a host points the media surfaces at its
 * own media base URL. Absent ⇒ the surfaces keep their built-in literal
 * default, so astro-cms / local dev stay byte-identical.
 */
describe('UIConfig.assetsBasePath', () => {
  afterEach(() => {
    // Reset module-global config so one case's injection can't leak.
    configureUI({});
  });

  it('round-trips a host-injected serve base', () => {
    configureUI({ assetsBasePath: 'https://media.example.test/assets/serve' });
    expect(getUIConfig().assetsBasePath).toBe('https://media.example.test/assets/serve');
  });

  it('is undefined when the host does not inject it', () => {
    configureUI({ basename: '/__cms' });
    expect(getUIConfig().assetsBasePath).toBeUndefined();
  });
});

/**
 * `setTemplates` is the post-configure swap point for the create-page
 * dropdown — replaced wholesale on every call, and undefined clears, so one
 * site's templates never leak onto the next.
 */
describe('setTemplates', () => {
  afterEach(() => {
    configureUI({});
  });

  it('installs templates after configureUI', () => {
    configureUI({ hosted: true });
    setTemplates({ blog: { label: 'Blog Post', component: 'BlogPostTemplate', pathPrefix: '/blog/' } });
    expect(getUIConfig().templates).toEqual({
      blog: { label: 'Blog Post', component: 'BlogPostTemplate', pathPrefix: '/blog/' },
    });
  });

  it('undefined clears the previous templates', () => {
    configureUI({ hosted: true });
    setTemplates({ blog: { label: 'Blog Post', component: 'BlogPostTemplate' } });
    setTemplates(undefined);
    expect(getUIConfig().templates).toBeUndefined();
  });
});

/**
 * `setDataBindings` is the post-configure swap point for the site's routing
 * bindings — replaced wholesale on every call, and undefined clears, so one
 * site's bindings never leak onto the next.
 */
describe('setDataBindings', () => {
  afterEach(() => {
    configureUI({});
  });

  it('installs the bindings the page editor builds its data context from', () => {
    configureUI({ hosted: true });
    setDataBindings({ siteName: 'default', locale: 'en', routes: { pages: { pages: { prefix: '/' } } } });
    expect(getUIConfig().dataBindings).toEqual({
      siteName: 'default',
      locale: 'en',
      routes: { pages: { pages: { prefix: '/' } } },
    });
  });

  it('undefined clears the previous bindings', () => {
    configureUI({ hosted: true });
    setDataBindings({ siteName: 'default', locale: 'en', routes: { pages: { pages: { prefix: '/' } } } });
    setDataBindings(undefined);
    expect(getUIConfig().dataBindings).toBeUndefined();
  });
});
