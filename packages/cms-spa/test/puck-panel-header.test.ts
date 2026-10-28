import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Puck lays the right panel's parent link and the selected block's heading out on one row and never lets the link
// shrink, so on a narrow panel a long parent name runs over the heading or past the panel's edge. main.css wraps the
// row and truncates the link; these checks fail when a Puck upgrade renames or restyles the classes it relies on.

const puckCss = readFileSync(Bun.resolveSync('@puckeditor/core/no-external.css', import.meta.dir), 'utf8');
const mainCss = readFileSync(join(import.meta.dir, '../src/main.css'), 'utf8');

describe('right panel header on a narrow panel', () => {
  test('the header row still exists in Puck and wraps instead of overlapping', () => {
    expect(puckCss).toMatch(/SidebarSection-breadcrumbs_\w+ \{[^}]*display: flex;/);
    expect(puckCss).toMatch(/SidebarSection-heading_\w+ \{/);
    expect(mainCss).toMatch(/^\[class\*="SidebarSection-breadcrumbs"\] \{[^}]*flex-wrap: wrap;/m);
  });

  test('Puck still refuses to shrink the parent link, which main.css truncates with an ellipsis', () => {
    expect(puckCss).toMatch(/Breadcrumbs-breadcrumbLabel_\w+ \{[^}]*flex-shrink: 0;/);
    expect(mainCss).toMatch(/^\[class\*="Breadcrumbs"\] \{[^}]*min-width: 0;/m);
    expect(mainCss).toMatch(/^\[class\*="Breadcrumbs-breadcrumbLabel"\] \{[^}]*text-overflow: ellipsis;/m);
  });
});
