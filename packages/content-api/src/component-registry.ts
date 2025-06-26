import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import sortKeys from 'sort-keys';
import type {
  ComponentEntry,
  ComponentEntryWithId,
  ComponentRegistry as ComponentRegistryType,
} from './component-registry.types';

/**
 * Component Registry for managing linked and unlinked components
 *
 * Registry is stored at {canvasDir}/components/registry.json
 * Component IDs must follow the format: vx-{uuid}
 */
export class ComponentRegistry {
  private registryPath: string;
  private registry: ComponentRegistryType = {};
  private initialized = false;

  constructor(canvasDir: string) {
    this.registryPath = join(canvasDir, 'components', 'registry.json');
  }

  /**
   * Initialize the registry by loading from disk or creating new
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const content = await readFile(this.registryPath, 'utf-8');
      this.registry = JSON.parse(content);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, create empty registry
        await this.save();
      } else {
        throw error;
      }
    }

    this.initialized = true;
  }

  /**
   * Validate component ID format (vx-{uuid})
   */
  private validateComponentId(id: string): void {
    const uuidRegex = /^vx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      throw new Error('Invalid component ID format. Expected: vx-{uuid}');
    }
  }

  /**
   * Save registry to disk atomically
   */
  private async save(): Promise<void> {
    const tempPath = `${this.registryPath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 9)}`;

    try {
      // Ensure directory exists
      await mkdir(dirname(this.registryPath), { recursive: true });

      // Sort keys for consistent output
      const sorted = sortKeys(this.registry, { deep: true });
      const content = JSON.stringify(sorted, null, 2);

      // Write to temp file
      await writeFile(tempPath, content);

      // Atomic rename
      await rename(tempPath, this.registryPath);
    } catch (error) {
      // Clean up temp file on error
      try {
        await unlink(tempPath);
      } catch {}
      throw error;
    }
  }

  /**
   * Register a new component or update existing
   */
  async register(id: string, entry: ComponentEntry): Promise<void> {
    await this.initialize();
    this.validateComponentId(id);

    this.registry[id] = {
      displayName: entry.displayName,
      path: entry.path,
    };

    await this.save();
  }

  /**
   * Get a component entry by ID
   */
  async get(id: string): Promise<ComponentEntry | null> {
    await this.initialize();
    return this.registry[id] || null;
  }

  /**
   * Link a component to a path
   */
  async link(id: string, path: string): Promise<void> {
    await this.initialize();

    const entry = this.registry[id];
    if (!entry) {
      throw new Error(`Component ${id} not found in registry`);
    }

    entry.path = path;
    await this.save();
  }

  /**
   * Unlink a component (set path to null)
   */
  async unlink(id: string): Promise<void> {
    await this.initialize();

    const entry = this.registry[id];
    if (!entry) {
      throw new Error(`Component ${id} not found in registry`);
    }

    entry.path = null;
    await this.save();
  }

  /**
   * List all components
   */
  async list(): Promise<ComponentEntryWithId[]> {
    await this.initialize();

    return Object.entries(this.registry).map(([id, entry]) => ({
      id,
      ...entry,
    }));
  }

  /**
   * Delete a component from registry
   */
  async delete(id: string): Promise<void> {
    await this.initialize();

    delete this.registry[id];
    await this.save();
  }
}
