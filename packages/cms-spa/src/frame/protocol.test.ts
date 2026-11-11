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
  type Init,
  isFramePath,
  readControlMessage,
} from './protocol.js';

const REFUSED = [
  'findUntranslatedContent',
  'getGitStatus',
  'commitChanges',
  'pushChanges',
  'pullChanges',
  'getCurrentUser',
  // Clobbered saves are recorded by a local dev server only.
  'getClobbered',
  'dismissClobbered',
];
const appOnly = (label: string) => label === 'app';
const BASE_INIT: Init = {
  kind: 'init',
  initialPath: '/',
  readOnly: null,
  previewCapability: 'unknown',
  theme: 'system',
  mediaEnabled: false,
};

describe('the doc channel', () => {
  test('reads an init with docChannel and still reads one without it', () => {
    expect(readControlMessage({ ...BASE_INIT, docChannel: true })).toMatchObject({ kind: 'init', docChannel: true });
    expect(readControlMessage(BASE_INIT)).not.toHaveProperty('docChannel');
    expect(readControlMessage({ ...BASE_INIT, docChannel: 'yes' })).not.toHaveProperty('docChannel');
  });

  test('allows the doc methods with their arities', () => {
    expect(FRAME_HOST_METHODS).toEqual(expect.arrayContaining(['doc.open', 'doc.close', 'doc.flush']));
    expect(FRAME_METHOD_MAX_ARGS['doc.open']).toBe(1);
    expect(FRAME_METHOD_MAX_ARGS['doc.close']).toBe(1);
    expect(FRAME_METHOD_MAX_ARGS['doc.flush']).toBe(0);
    expect(FRAME_CONTENT_METHODS).not.toContain('doc.open');
  });
});

describe('the draft tools', () => {
  test('reads an init with draftTools and still reads one without it', () => {
    expect(readControlMessage({ ...BASE_INIT, draftTools: true })).toMatchObject({ kind: 'init', draftTools: true });
    expect(readControlMessage(BASE_INIT)).not.toHaveProperty('draftTools');
    expect(readControlMessage({ ...BASE_INIT, draftTools: 'yes' })).not.toHaveProperty('draftTools');
  });

  test('allows the five draft-tools methods with one argument each, never as content methods', () => {
    for (const method of [
      'conflicts.list',
      'conflicts.resolve',
      'pages.discard',
      'snapshots.list',
      'snapshots.restore',
    ] as const) {
      expect(FRAME_METHOD_MAX_ARGS[method]).toBe(1);
    }
    expect(FRAME_CONTENT_METHODS).not.toContain('pages.discard');
  });
});

describe('the editor frame contract', () => {
  test('the page speaks a protocol inside the parent range', () => {
    expect(EDITOR_HOST_PROTOCOL).toBe(1);
    expect(EDITOR_HOST_PROTOCOL).toBeGreaterThanOrEqual(EDITOR_HOST_PROTOCOLS.min);
    expect(EDITOR_HOST_PROTOCOLS).toEqual({ min: 1, max: 1 });
  });

  test('the content methods are every classified method except the eight the parent never serves', () => {
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
      'doc.open',
      'doc.close',
      'doc.flush',
      'conflicts.list',
      'conflicts.resolve',
      'pages.discard',
      'snapshots.list',
      'snapshots.restore',
    ]);
  });

  test('each content method allows exactly as many arguments as the client declares', () => {
    for (const method of FRAME_CONTENT_METHODS) {
      const declared = ContentAPIClient.prototype[method].length;
      // listFolder(path = '/') reports 0: a default parameter ends Function.length.
      expect<number>(FRAME_METHOD_MAX_ARGS[method]).toBe(method === 'listFolder' ? 1 : declared);
    }
    for (const method of FRAME_HOST_METHODS) {
      expect<number>(FRAME_METHOD_MAX_ARGS[method]).toBe(method === 'doc.flush' ? 0 : 1);
    }
  });

  test('a route path is a cms-spa path with an optional query', () => {
    for (const ok of ['/', '/pages/abc', '/media?folder=uploads%2Fx', '/pages/a:b-c_d.e']) {
      expect(isFramePath(ok)).toBe(true);
    }
    for (const bad of ['', 'pages', '//evil.test', '/a//b', '/a#h', '/a b', `/${'a'.repeat(513)}`, '/a?x=<']) {
      expect(isFramePath(bad)).toBe(false);
    }
  });

  test('an init carries the facts for converting pages, without hostile routes', () => {
    const read = readControlMessage({
      ...BASE_INIT,
      pageConversion: { cliVersion: '0.2.4', site: 'default', routes: ['/', '/x"; rm -rf ~'] },
    });
    expect(read).toMatchObject({ pageConversion: { cliVersion: '0.2.4', site: 'default', routes: ['/'] } });
  });

  test('an init with malformed page conversion facts stays valid, without them', () => {
    expect(readControlMessage({ ...BASE_INIT, pageConversion: { cliVersion: 'x' } })).toEqual(BASE_INIT);
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
