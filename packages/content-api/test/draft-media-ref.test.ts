import { describe, expect, it } from 'bun:test';
import { draftMediaRef, draftMediaRefPath, mediaRefPath } from '../src/draft-media-ref.js';

describe('draft media address', () => {
  it('builds and reads back a nested upload path', () => {
    expect(draftMediaRef('uploads/hero.png')).toBe('/api/v1/assets/serve/uploads/hero.png');
    expect(draftMediaRefPath('/api/v1/assets/serve/uploads/hero.png')).toBe('uploads/hero.png');
  });

  it('keeps raw characters and never decodes', () => {
    expect(draftMediaRefPath('/api/v1/assets/serve/a b/%20.png')).toBe('a b/%20.png');
  });

  it('refuses a site image link, traversal, query, non-image and bare base', () => {
    for (const value of [
      '/assets/hero.png',
      '/api/v1/assets/serve/../x.png',
      '/api/v1/assets/serve/a//b.png',
      '/api/v1/assets/serve/x.png?v=1',
      '/api/v1/assets/serve/x.txt',
      '/api/v1/assets/serve/',
      'https://x.test/api/v1/assets/serve/x.png',
    ])
      expect(draftMediaRefPath(value)).toBeUndefined();
  });

  it('reads a path under any base with the same rules', () => {
    expect(mediaRefPath('/assets/photos/a.png', '/assets')).toBe('photos/a.png');
    expect(mediaRefPath('/assets/../a.png', '/assets')).toBeUndefined();
  });
});
