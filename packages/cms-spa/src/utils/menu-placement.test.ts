import { describe, expect, it } from 'vitest';
import { menuOpensUp } from './menu-placement.js';

describe('menuOpensUp', () => {
  const viewportHeight = 800;

  it('opens down when the menu fits below the trigger', () => {
    expect(menuOpensUp({ top: 100, bottom: 128 }, viewportHeight)).toBe(false);
  });

  it('opens up when the menu would fall past the viewport bottom', () => {
    expect(menuOpensUp({ top: 740, bottom: 768 }, viewportHeight)).toBe(true);
  });

  it('stays down when there is no room above either', () => {
    expect(menuOpensUp({ top: 20, bottom: 48 }, 120)).toBe(false);
  });
});
