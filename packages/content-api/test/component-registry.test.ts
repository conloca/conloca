import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ComponentRegistry } from '../src/component-registry';

describe('ComponentRegistry', () => {
  let tempDir: string;
  let registry: ComponentRegistry;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'conloca-registry-test-'));
    const canvasDir = join(tempDir, 'canvas');
    await mkdir(canvasDir, { recursive: true });

    registry = new ComponentRegistry(canvasDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('registry initialization', () => {
    test('creates registry file if it does not exist', async () => {
      const registryPath = join(tempDir, 'canvas', 'components', 'registry.json');

      // Initialize registry
      await registry.initialize();

      // Check file exists
      const content = await readFile(registryPath, 'utf-8');
      expect(JSON.parse(content)).toEqual({});
    });

    test('loads existing registry', async () => {
      const registryPath = join(tempDir, 'canvas', 'components', 'registry.json');
      const existingRegistry = {
        'vx-550e8400-e29b-41d4-a716-446655440000': {
          displayName: 'About Page Layout',
          path: null,
        },
      };

      // Create the components directory first
      await mkdir(join(tempDir, 'canvas', 'components'), { recursive: true });
      await writeFile(registryPath, JSON.stringify(existingRegistry, null, 2));

      await registry.initialize();
      const component = await registry.get('vx-550e8400-e29b-41d4-a716-446655440000');

      expect(component).toEqual({
        displayName: 'About Page Layout',
        path: null,
      });
    });
  });

  describe('register', () => {
    test('registers new component', async () => {
      await registry.initialize();

      const componentId = 'vx-660f9120-318c-4e3d-9b45-887fc3d7ce2e';
      const entry = {
        displayName: 'Button',
        path: 'components/Button',
      };

      await registry.register(componentId, entry);

      const retrieved = await registry.get(componentId);
      expect(retrieved).toEqual(entry);
    });

    test('updates existing component', async () => {
      await registry.initialize();

      const componentId = 'vx-660f9120-318c-4e3d-9b45-887fc3d7ce2e';
      const initial = {
        displayName: 'Button',
        path: null,
      };
      const updated = {
        displayName: 'Primary Button',
        path: 'components/Button',
      };

      await registry.register(componentId, initial);
      await registry.register(componentId, updated);

      const retrieved = await registry.get(componentId);
      expect(retrieved).toEqual(updated);
    });
  });

  describe('link', () => {
    test('updates path correctly', async () => {
      await registry.initialize();

      const componentId = 'vx-550e8400-e29b-41d4-a716-446655440000';

      // Register unlinked component
      await registry.register(componentId, {
        displayName: 'Hero Section',
        path: null,
      });

      // Link it
      await registry.link(componentId, 'components/HeroSection');

      const retrieved = await registry.get(componentId);
      expect(retrieved?.path).toBe('components/HeroSection');
    });

    test('throws error for non-existent component', async () => {
      await registry.initialize();

      await expect(registry.link('vx-nonexistent', 'some/path')).rejects.toThrow(
        'Component vx-nonexistent not found in registry',
      );
    });
  });

  describe('unlink', () => {
    test('sets path to null', async () => {
      await registry.initialize();

      const componentId = 'vx-7f3e9a00-42b8-4c67-b830-2a4b9b3d8f90';

      // Register linked component
      await registry.register(componentId, {
        displayName: 'Card',
        path: 'components/Card',
      });

      // Unlink it
      await registry.unlink(componentId);

      const retrieved = await registry.get(componentId);
      expect(retrieved?.path).toBeNull();
    });

    test('preserves displayName when unlinking', async () => {
      await registry.initialize();

      const componentId = 'vx-7f3e9a00-42b8-4c67-b830-2a4b9b3d8f90';
      const displayName = 'Card Component';

      await registry.register(componentId, {
        displayName,
        path: 'components/Card',
      });

      await registry.unlink(componentId);

      const retrieved = await registry.get(componentId);
      expect(retrieved?.displayName).toBe(displayName);
    });
  });

  describe('concurrent registry updates', () => {
    test('handles concurrent updates atomically', async () => {
      await registry.initialize();

      const updates = Array.from({ length: 10 }, (_, i) => ({
        id: `vx-0000000${i}-0000-0000-0000-00000000000${i}`,
        entry: {
          displayName: `Component ${i}`,
          path: i % 2 === 0 ? `components/Component${i}` : null,
        },
      }));

      // Register all components concurrently
      await Promise.all(updates.map(({ id, entry }) => registry.register(id, entry)));

      // Verify all were registered
      for (const { id, entry } of updates) {
        const retrieved = await registry.get(id);
        expect(retrieved).toEqual(entry);
      }

      // Verify registry file is valid JSON
      const registryPath = join(tempDir, 'canvas', 'components', 'registry.json');
      const content = await readFile(registryPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(Object.keys(parsed)).toHaveLength(10);
    });
  });

  describe('invalid component IDs', () => {
    test('rejects invalid component ID format', async () => {
      await registry.initialize();

      const invalidIds = [
        'invalid-id',
        '550e8400-e29b-41d4-a716-446655440000', // Missing vx- prefix
        'vx_550e8400-e29b-41d4-a716-446655440000', // Wrong separator
        'vx-not-a-uuid',
        '',
      ];

      for (const id of invalidIds) {
        await expect(registry.register(id, { displayName: 'Test', path: null })).rejects.toThrow(
          'Invalid component ID format',
        );
      }
    });

    test('accepts valid component ID format', async () => {
      await registry.initialize();

      const validIds = [
        'vx-550e8400-e29b-41d4-a716-446655440000',
        'vx-00000000-0000-0000-0000-000000000000',
        'vx-ffffffff-ffff-ffff-ffff-ffffffffffff',
      ];

      for (const id of validIds) {
        await registry.register(id, { displayName: 'Test', path: null });
        const retrieved = await registry.get(id);
        expect(retrieved).toBeDefined();
      }
    });
  });

  describe('list and delete operations', () => {
    test('lists all components', async () => {
      await registry.initialize();

      const components = {
        'vx-111e8400-e29b-41d4-a716-446655440001': {
          displayName: 'Component 1',
          path: null,
        },
        'vx-222e8400-e29b-41d4-a716-446655440002': {
          displayName: 'Component 2',
          path: 'components/Component2',
        },
      };

      for (const [id, entry] of Object.entries(components)) {
        await registry.register(id, entry);
      }

      const list = await registry.list();
      expect(list).toHaveLength(2);
      expect(list).toContainEqual({
        id: 'vx-111e8400-e29b-41d4-a716-446655440001',
        ...components['vx-111e8400-e29b-41d4-a716-446655440001'],
      });
      expect(list).toContainEqual({
        id: 'vx-222e8400-e29b-41d4-a716-446655440002',
        ...components['vx-222e8400-e29b-41d4-a716-446655440002'],
      });
    });

    test('deletes component from registry', async () => {
      await registry.initialize();

      const componentId = 'vx-333e8400-e29b-41d4-a716-446655440003';
      await registry.register(componentId, {
        displayName: 'To Delete',
        path: null,
      });

      // Verify it exists
      expect(await registry.get(componentId)).toBeDefined();

      // Delete it
      await registry.delete(componentId);

      // Verify it's gone
      expect(await registry.get(componentId)).toBeNull();
    });
  });

  describe('registry file format', () => {
    test('maintains sorted keys in registry file', async () => {
      await registry.initialize();

      // Add components in non-alphabetical order
      await registry.register('vx-ccc00000-0000-0000-0000-000000000000', {
        displayName: 'Component C',
        path: null,
      });
      await registry.register('vx-aaa00000-0000-0000-0000-000000000000', {
        displayName: 'Component A',
        path: null,
      });
      await registry.register('vx-bbb00000-0000-0000-0000-000000000000', {
        displayName: 'Component B',
        path: null,
      });

      // Read file and check key order
      const registryPath = join(tempDir, 'canvas', 'components', 'registry.json');
      const content = await readFile(registryPath, 'utf-8');
      const keys = Object.keys(JSON.parse(content));

      expect(keys).toEqual([
        'vx-aaa00000-0000-0000-0000-000000000000',
        'vx-bbb00000-0000-0000-0000-000000000000',
        'vx-ccc00000-0000-0000-0000-000000000000',
      ]);
    });

    test('uses consistent JSON formatting', async () => {
      await registry.initialize();

      await registry.register('vx-fff00000-0000-0000-0000-000000000000', {
        displayName: 'Test Component',
        path: 'some/nested/path/Component',
      });

      const registryPath = join(tempDir, 'canvas', 'components', 'registry.json');
      const content = await readFile(registryPath, 'utf-8');

      // Check for 2-space indentation
      expect(content).toContain('  "vx-fff00000-0000-0000-0000-000000000000": {');
      expect(content).toContain('    "displayName": "Test Component"');
      expect(content).toContain('    "path": "some/nested/path/Component"');
    });
  });
});
