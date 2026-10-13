/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { getHostDiscovery, setHostDiscovery } from './host-discovery.js';

afterEach(() => {
  setHostDiscovery({});
});

describe('host discovery registry', () => {
  test('starts empty — astro-cms never writes it, so the editor chain skips it', () => {
    expect(getHostDiscovery()).toEqual({});
  });

  test('round-trips the route CSS and wrapper shape', () => {
    const wrappers = { content: { tagName: 'ARTICLE', className: 'post-body' }, codeBlock: null };
    setHostDiscovery({ routeCss: '.post-body p{font-size:17px}', wrappers });
    expect(getHostDiscovery().routeCss).toContain('17px');
    expect(getHostDiscovery().wrappers).toEqual(wrappers);
  });

  test('clearing replaces wholesale — switching to another site must not leak the previous one', () => {
    setHostDiscovery({ routeCss: '.a{}', wrappers: { content: null, codeBlock: null } });
    setHostDiscovery({});
    expect(getHostDiscovery()).toEqual({});
  });
});
