import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveComponentPaths, scanForHydratableComponents } from '../src/lib/hydration-scanner.js';

// Copy regex patterns from source for direct unit testing (not exported)
const HYDRATION_IMPORT_PATTERN =
  /import\s+\{[^}]*withHydration[^}]*\}\s+from\s+['"]@conloca\/astro-cms(?:\/hydration)?['"]/;
const HYDRATION_PATTERN = /withHydration\s*\(\s*\w+\s*,\s*['"](\w+)['"]\s*\)/g;

describe('Hydration Scanner', () => {
  // -----------------------------------------------------------------
  // HYDRATION_IMPORT_PATTERN — direct regex tests
  // -----------------------------------------------------------------
  describe('HYDRATION_IMPORT_PATTERN', () => {
    test('matches standard named import from @conloca/astro-cms', () => {
      const line = "import { withHydration } from '@conloca/astro-cms'";
      expect(HYDRATION_IMPORT_PATTERN.test(line)).toBe(true);
    });

    test('matches named import from @conloca/astro-cms/hydration', () => {
      const line = "import { withHydration } from '@conloca/astro-cms/hydration'";
      expect(HYDRATION_IMPORT_PATTERN.test(line)).toBe(true);
    });

    test('matches multiple named imports', () => {
      const line = "import { someOther, withHydration } from '@conloca/astro-cms'";
      expect(HYDRATION_IMPORT_PATTERN.test(line)).toBe(true);
    });

    test('matches withHydration as first import among multiple', () => {
      const line = "import { withHydration, someOther } from '@conloca/astro-cms'";
      expect(HYDRATION_IMPORT_PATTERN.test(line)).toBe(true);
    });

    test('matches multiline import', () => {
      const content = [
        'import {',
        '  someOther,',
        '  withHydration,',
        '  anotherThing',
        "} from '@conloca/astro-cms'",
      ].join('\n');
      expect(HYDRATION_IMPORT_PATTERN.test(content)).toBe(true);
    });

    test('matches with double quotes', () => {
      const line = 'import { withHydration } from "@conloca/astro-cms"';
      expect(HYDRATION_IMPORT_PATTERN.test(line)).toBe(true);
    });

    test('rejects import from wrong package', () => {
      const line = "import { withHydration } from 'other-package'";
      expect(HYDRATION_IMPORT_PATTERN.test(line)).toBe(false);
    });

    test('rejects default import (not destructured)', () => {
      const line = "import withHydration from '@conloca/astro-cms'";
      expect(HYDRATION_IMPORT_PATTERN.test(line)).toBe(false);
    });

    test('rejects file with no withHydration import', () => {
      const content = "import { someHelper } from '@conloca/astro-cms'";
      expect(HYDRATION_IMPORT_PATTERN.test(content)).toBe(false);
    });

    test('rejects namespace import', () => {
      const line = "import * as hydration from '@conloca/astro-cms'";
      expect(HYDRATION_IMPORT_PATTERN.test(line)).toBe(false);
    });
  });

  // -----------------------------------------------------------------
  // HYDRATION_PATTERN — direct regex tests
  // -----------------------------------------------------------------
  describe('HYDRATION_PATTERN', () => {
    function extractStrategies(content: string): string[] {
      // Reset lastIndex for global regex
      HYDRATION_PATTERN.lastIndex = 0;
      return [...content.matchAll(HYDRATION_PATTERN)].map((m) => m[1]);
    }

    test('extracts load strategy with single quotes', () => {
      const content = "withHydration(Foo, 'load')";
      expect(extractStrategies(content)).toEqual(['load']);
    });

    test('extracts visible strategy', () => {
      const content = "withHydration(Bar, 'visible')";
      expect(extractStrategies(content)).toEqual(['visible']);
    });

    test('extracts idle strategy', () => {
      const content = "withHydration(Baz, 'idle')";
      expect(extractStrategies(content)).toEqual(['idle']);
    });

    test('handles whitespace variations', () => {
      const content = "withHydration( Foo , 'load' )";
      expect(extractStrategies(content)).toEqual(['load']);
    });

    test('handles double quotes', () => {
      const content = 'withHydration(Foo, "load")';
      expect(extractStrategies(content)).toEqual(['load']);
    });

    test('extracts strategy from real-world render pattern', () => {
      const content = "render: withHydration(BlogPostGridComponent, 'load'),";
      expect(extractStrategies(content)).toEqual(['load']);
    });

    test('extracts multiple calls in same file', () => {
      const content = ["const A = withHydration(Foo, 'load')", "const B = withHydration(Bar, 'visible')"].join('\n');
      expect(extractStrategies(content)).toEqual(['load', 'visible']);
    });

    test('captures invalid strategy name for validation downstream', () => {
      const content = "withHydration(Foo, 'hover')";
      // The regex captures 'hover' -- validation happens in scanForHydratableComponents
      expect(extractStrategies(content)).toEqual(['hover']);
    });

    test('does not match call without strategy argument', () => {
      const content = 'withHydration(Foo)';
      expect(extractStrategies(content)).toEqual([]);
    });
  });

  // -----------------------------------------------------------------
  // deriveComponentPaths — pure function tests
  // -----------------------------------------------------------------
  describe('deriveComponentPaths', () => {
    test('derives scan path from puckConfigPath', () => {
      const result = deriveComponentPaths('./src/puck.config.tsx');
      expect(result).toEqual(['src/components/puck']);
    });

    test('derives scan path from nested puckConfigPath', () => {
      const result = deriveComponentPaths('./packages/website/src/puck.config.tsx');
      expect(result).toEqual(['packages/website/src/components/puck']);
    });

    test('merges explicit paths with auto-derived path', () => {
      const result = deriveComponentPaths('./src/puck.config.tsx', ['./custom/components']);
      expect(result).toEqual(['src/components/puck', './custom/components']);
    });

    test('returns only auto-derived path when explicitPaths is empty array', () => {
      const result = deriveComponentPaths('./src/puck.config.tsx', []);
      expect(result).toEqual(['src/components/puck']);
    });

    test('returns only auto-derived path when explicitPaths is undefined', () => {
      const result = deriveComponentPaths('./src/puck.config.tsx', undefined);
      expect(result).toEqual(['src/components/puck']);
    });
  });

  // -----------------------------------------------------------------
  // scanForHydratableComponents — integration tests with temp files
  // -----------------------------------------------------------------
  describe('scanForHydratableComponents', () => {
    let tempDir: string;
    let componentsDir: string;

    beforeAll(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'hydration-scanner-test-'));
      componentsDir = join(tempDir, 'components', 'puck');
      await mkdir(componentsDir, { recursive: true });
    });

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    test('discovers component with load strategy', async () => {
      const filePath = join(componentsDir, 'TestimonialGrid.tsx');
      await writeFile(
        filePath,
        [
          "import { withHydration } from '@conloca/astro-cms/hydration'",
          '',
          "const HydratedTestimonialGrid = withHydration(TestimonialGrid, 'load')",
          'export default HydratedTestimonialGrid',
        ].join('\n'),
      );

      const results = await scanForHydratableComponents(['components/puck'], tempDir);
      const found = results.find((r) => r.componentName === 'TestimonialGrid');
      expect(found).toBeDefined();
      expect(found!.strategy).toBe('load');
      expect(found!.filePath).toBe(filePath);
    });

    test('discovers component with visible strategy', async () => {
      const filePath = join(componentsDir, 'LazyImage.tsx');
      await writeFile(
        filePath,
        [
          "import { withHydration } from '@conloca/astro-cms'",
          '',
          "const HydratedLazyImage = withHydration(LazyImage, 'visible')",
          'export default HydratedLazyImage',
        ].join('\n'),
      );

      const results = await scanForHydratableComponents(['components/puck'], tempDir);
      const found = results.find((r) => r.componentName === 'LazyImage');
      expect(found).toBeDefined();
      expect(found!.strategy).toBe('visible');
    });

    test('discovers component with idle strategy', async () => {
      const filePath = join(componentsDir, 'NewsletterForm.tsx');
      await writeFile(
        filePath,
        [
          "import { withHydration } from '@conloca/astro-cms/hydration'",
          '',
          "const Hydrated = withHydration(NewsletterForm, 'idle')",
          'export default Hydrated',
        ].join('\n'),
      );

      const results = await scanForHydratableComponents(['components/puck'], tempDir);
      const found = results.find((r) => r.componentName === 'NewsletterForm');
      expect(found).toBeDefined();
      expect(found!.strategy).toBe('idle');
    });

    test('derives PascalCase name from kebab-case filename', async () => {
      const filePath = join(componentsDir, 'blog-post-grid.tsx');
      await writeFile(
        filePath,
        [
          "import { withHydration } from '@conloca/astro-cms/hydration'",
          '',
          "const Hydrated = withHydration(BlogPostGrid, 'load')",
          'export default Hydrated',
        ].join('\n'),
      );

      const results = await scanForHydratableComponents(['components/puck'], tempDir);
      const found = results.find((r) => r.componentName === 'BlogPostGrid');
      expect(found).toBeDefined();
      expect(found!.strategy).toBe('load');
    });

    test('skips .tsx files that do not import withHydration', async () => {
      await writeFile(
        join(componentsDir, 'PlainComponent.tsx'),
        ["import React from 'react'", '', 'export const PlainComponent = () => <div>Hello</div>'].join('\n'),
      );

      const results = await scanForHydratableComponents(['components/puck'], tempDir);
      const found = results.find((r) => r.componentName === 'PlainComponent');
      expect(found).toBeUndefined();
    });

    test('skips files with import but no withHydration call', async () => {
      await writeFile(
        join(componentsDir, 'ImportOnly.tsx'),
        [
          "import { withHydration } from '@conloca/astro-cms/hydration'",
          '',
          '// Imported but never called',
          'export const ImportOnly = () => <div>Not hydrated</div>',
        ].join('\n'),
      );

      const results = await scanForHydratableComponents(['components/puck'], tempDir);
      const found = results.find((r) => r.componentName === 'ImportOnly');
      expect(found).toBeUndefined();
    });

    test('skips files with invalid strategy', async () => {
      await writeFile(
        join(componentsDir, 'InvalidStrategy.tsx'),
        [
          "import { withHydration } from '@conloca/astro-cms/hydration'",
          '',
          "const Hydrated = withHydration(InvalidStrategy, 'hover')",
          'export default Hydrated',
        ].join('\n'),
      );

      const results = await scanForHydratableComponents(['components/puck'], tempDir);
      const found = results.find((r) => r.componentName === 'InvalidStrategy');
      expect(found).toBeUndefined();
    });

    test('returns empty array for directory with no hydratable components', async () => {
      const emptyDir = join(tempDir, 'empty-components');
      await mkdir(emptyDir, { recursive: true });
      await writeFile(join(emptyDir, 'Static.tsx'), 'export const Static = () => <div>Static</div>');

      const results = await scanForHydratableComponents(['empty-components'], tempDir);
      expect(results).toEqual([]);
    });

    test('matches real-world CorpOS usage pattern', async () => {
      const realWorldDir = join(tempDir, 'real-world');
      await mkdir(realWorldDir, { recursive: true });

      await writeFile(
        join(realWorldDir, 'BlogPostGrid.tsx'),
        [
          "import type { ComponentConfig } from '@measured/puck'",
          "import { withHydration } from '@conloca/astro-cms/hydration'",
          "import { BlogPostGridComponent } from './BlogPostGridComponent'",
          '',
          'export const BlogPostGrid: ComponentConfig = {',
          "  label: 'Blog Post Grid',",
          '  fields: {},',
          "  render: withHydration(BlogPostGridComponent, 'load'),",
          '}',
        ].join('\n'),
      );

      const results = await scanForHydratableComponents(['real-world'], tempDir);
      expect(results).toHaveLength(1);
      expect(results[0].componentName).toBe('BlogPostGrid');
      expect(results[0].strategy).toBe('load');
    });

    test('handles multiline import with withHydration call', async () => {
      const multilineDir = join(tempDir, 'multiline');
      await mkdir(multilineDir, { recursive: true });

      await writeFile(
        join(multilineDir, 'MultilineImport.tsx'),
        [
          'import {',
          '  someHelper,',
          '  withHydration,',
          '  anotherThing',
          "} from '@conloca/astro-cms'",
          '',
          "const Hydrated = withHydration(MultilineImport, 'visible')",
          'export default Hydrated',
        ].join('\n'),
      );

      const results = await scanForHydratableComponents(['multiline'], tempDir);
      expect(results).toHaveLength(1);
      expect(results[0].componentName).toBe('MultilineImport');
      expect(results[0].strategy).toBe('visible');
    });

    test('handles double quotes in withHydration call', async () => {
      const dqDir = join(tempDir, 'double-quotes');
      await mkdir(dqDir, { recursive: true });

      await writeFile(
        join(dqDir, 'DoubleQuoted.tsx'),
        [
          "import { withHydration } from '@conloca/astro-cms/hydration'",
          '',
          'const Hydrated = withHydration(DoubleQuoted, "idle")',
          'export default Hydrated',
        ].join('\n'),
      );

      const results = await scanForHydratableComponents(['double-quotes'], tempDir);
      expect(results).toHaveLength(1);
      expect(results[0].componentName).toBe('DoubleQuoted');
      expect(results[0].strategy).toBe('idle');
    });

    test('handles whitespace variations in withHydration call', async () => {
      const wsDir = join(tempDir, 'whitespace');
      await mkdir(wsDir, { recursive: true });

      await writeFile(
        join(wsDir, 'WhitespaceCall.tsx'),
        [
          "import { withHydration } from '@conloca/astro-cms/hydration'",
          '',
          "const Hydrated = withHydration( WhitespaceCall , 'load' )",
          'export default Hydrated',
        ].join('\n'),
      );

      const results = await scanForHydratableComponents(['whitespace'], tempDir);
      expect(results).toHaveLength(1);
      expect(results[0].componentName).toBe('WhitespaceCall');
      expect(results[0].strategy).toBe('load');
    });
  });
});
