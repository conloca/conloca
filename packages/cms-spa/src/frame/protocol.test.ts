import { describe, expect, test } from 'bun:test';
import { ContentAPIClient } from '@conloca/content-api-client';
import { CONTENT_METHOD_CLASSIFICATION } from '../write-access.js';
import {
  acceptsParentOrigin,
  EDITOR_HOST_PROTOCOL,
  EDITOR_HOST_PROTOCOLS,
  FRAME_CONTENT_METHODS,
  FRAME_HOST_METHODS,
  FRAME_METHOD_MAX_ARGS,
  isFramePath,
} from './protocol.js';

const REFUSED = [
  'findUntranslatedContent',
  'getGitStatus',
  'commitChanges',
  'pushChanges',
  'pullChanges',
  'getCurrentUser',
];
const appOnly = (label: string) => label === 'app';

describe('the editor frame contract', () => {
  test('the page speaks a protocol inside the parent range', () => {
    expect(EDITOR_HOST_PROTOCOL).toBe(1);
    expect(EDITOR_HOST_PROTOCOL).toBeGreaterThanOrEqual(EDITOR_HOST_PROTOCOLS.min);
    expect(EDITOR_HOST_PROTOCOLS).toEqual({ min: 1, max: 1 });
  });

  test('the content methods are every classified method except the six the parent never serves', () => {
    expect(FRAME_CONTENT_METHODS).toHaveLength(31);
    const served = [...FRAME_CONTENT_METHODS, ...REFUSED];
    expect(served).toHaveLength(Object.keys(CONTENT_METHOD_CLASSIFICATION).length);
    expect(new Set(served)).toEqual(new Set(Object.keys(CONTENT_METHOD_CLASSIFICATION)));
    expect(FRAME_HOST_METHODS).toEqual([
      'mediaBridge.getAssetScope',
      'mediaBridge.getMediaIssue',
      'media.load',
      'preview.open',
      'site.open',
    ]);
  });

  test('each content method allows exactly as many arguments as the client declares', () => {
    for (const method of FRAME_CONTENT_METHODS) {
      const declared = ContentAPIClient.prototype[method].length;
      // listFolder(path = '/') reports 0: a default parameter ends Function.length.
      expect<number>(FRAME_METHOD_MAX_ARGS[method]).toBe(method === 'listFolder' ? 1 : declared);
    }
    for (const method of FRAME_HOST_METHODS) expect(FRAME_METHOD_MAX_ARGS[method]).toBe(1);
  });

  test('a route path is a cms-spa path with an optional query', () => {
    for (const ok of ['/', '/pages/abc', '/media?folder=uploads%2Fx', '/pages/a:b-c_d.e']) {
      expect(isFramePath(ok)).toBe(true);
    }
    for (const bad of ['', 'pages', '//evil.test', '/a//b', '/a#h', '/a b', `/${'a'.repeat(513)}`, '/a?x=<']) {
      expect(isFramePath(bad)).toBe(false);
    }
  });
});

describe('which parent origins the editor page accepts', () => {
  test('one non-reserved label under the parent root, over https, without a port', () => {
    expect(acceptsParentOrigin('https://acme.example.com', 'example.com', appOnly)).toBe(true);
    expect(acceptsParentOrigin('https://acme.sub.example.com', 'sub.example.com', appOnly)).toBe(true);
  });

  test('refuses a reserved label, deeper names, the bare root, look-alikes, http, ports and opaque origins', () => {
    for (const origin of [
      'https://app.example.com',
      'https://a.b.example.com',
      'https://example.com',
      'https://acme.example.com.evil.test',
      'https://evilexample.com',
      'http://acme.example.com',
      'https://acme.example.com:8443',
      'https://-acme.example.com',
      'https://ACME.example.com',
      'null',
      'https://evil.test',
    ]) {
      expect(acceptsParentOrigin(origin, 'example.com', appOnly)).toBe(false);
    }
  });

  test('a .localhost root also allows http and any port', () => {
    expect(acceptsParentOrigin('http://personal.example.localhost:5180', 'example.localhost', appOnly)).toBe(true);
    expect(acceptsParentOrigin('http://app.example.localhost:5180', 'example.localhost', appOnly)).toBe(false);
  });
});
