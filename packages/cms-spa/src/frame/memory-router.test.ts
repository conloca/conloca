import { beforeEach, describe, expect, test } from 'bun:test';
import { createMemoryRouter, type DataRouter } from 'react-router-dom';
import { syncMemoryRouter } from './memory-router.js';

let router: DataRouter;

beforeEach(() => {
  router = createMemoryRouter([{ path: '*', element: null }], { initialEntries: ['/pages'] });
});

describe('the editor route mirrored to a parent frame', () => {
  test('each committed navigation is reported once, with its query and whether it replaced', async () => {
    const reported: [string, boolean][] = [];
    syncMemoryRouter(router, {
      initialPath: '/pages',
      onNavigate: (path, replace) => reported.push([path, replace]),
      subscribe: () => () => {},
    });

    await router.navigate('/pages/abc');
    await router.navigate('/media?folder=uploads', { replace: true });

    expect(reported).toEqual([
      ['/pages/abc', false],
      ['/media?folder=uploads', true],
    ]);
  });

  test('a navigation the parent asked for is not echoed back', async () => {
    let parentNavigate: ((path: string) => void) | undefined;
    const reported: string[] = [];
    syncMemoryRouter(router, {
      initialPath: '/pages',
      onNavigate: (path) => reported.push(path),
      subscribe: (navigate) => {
        parentNavigate = navigate;
        return () => {};
      },
    });

    parentNavigate?.('/fragments');
    await Bun.sleep(0);

    expect(router.state.location.pathname).toBe('/fragments');
    expect(reported).toEqual([]);
  });

  test('a parent route the router writes differently is still not echoed back', async () => {
    let parentNavigate: ((path: string) => void) | undefined;
    const reported: string[] = [];
    syncMemoryRouter(router, {
      initialPath: '/pages',
      onNavigate: (path) => reported.push(path),
      subscribe: (navigate) => {
        parentNavigate = navigate;
        return () => {};
      },
    });

    parentNavigate?.('/media?');
    await Bun.sleep(0);

    expect(router.state.location.pathname).toBe('/media');
    expect(reported).toEqual([]);
  });

  test('the returned function stops both directions', async () => {
    let parentListening = false;
    const reported: string[] = [];
    const stop = syncMemoryRouter(router, {
      initialPath: '/pages',
      onNavigate: (path) => reported.push(path),
      subscribe: () => {
        parentListening = true;
        return () => {
          parentListening = false;
        };
      },
    });

    stop();
    await router.navigate('/media');

    expect(parentListening).toBe(false);
    expect(reported).toEqual([]);
  });
});
