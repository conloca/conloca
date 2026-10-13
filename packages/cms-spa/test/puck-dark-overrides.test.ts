import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Dark mode repaints Puck's blue text by setting Puck's own custom properties.
// If a Puck upgrade renames one, the override stops applying without any error
// and the text falls back to Puck's dark blue on a near-black background.

const puckCss = readFileSync(Bun.resolveSync('@puckeditor/core/puck.css', import.meta.dir), 'utf8');
const mainCss = readFileSync(join(import.meta.dir, '../src/main.css'), 'utf8');
const darkBlock = mainCss.match(/^\.dark \{([^}]*)\}/m)?.[1] ?? '';

describe('dark-mode overrides of Puck blue text', () => {
  test.each([
    '--puck-pluginbar-color-text-selected',
    '--puck-pluginbar-color-text-hover',
    '--puck-drawer-category-color-text-hover',
    '--puck-drawer-item-color-text-hover',
    '--puck-field-color-text-active',
    '--puck-field-array-add-color-icon',
  ])('Puck still colors text with %s and dark mode sets it', (name) => {
    expect(puckCss).toMatch(new RegExp(`color: var\\(\\s*${name},`));
    expect(darkBlock).toMatch(new RegExp(`^\\s*${name}:`, 'm'));
  });

  // The right panel's parent link is rendered by Puck's Breadcrumbs component.
  test.each([
    ['', '--puck-color-interactive'],
    [':hover', '--puck-color-interactive-hover'],
    [':active', '--puck-color-interactive-active'],
  ])('the right panel parent link%s reads %s, which dark mode re-points on that link', (state, name) => {
    expect(puckCss).toMatch(new RegExp(`Breadcrumbs-breadcrumbLabel_\\w+${state} \\{[^}]*color: var\\(${name}\\);`));
    expect(mainCss).toMatch(new RegExp(`^\\.dark \\[class\\*="breadcrumbLabel"\\] \\{[^}]*${name}:`, 'm'));
  });
});
