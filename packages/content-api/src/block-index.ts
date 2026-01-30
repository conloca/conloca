import { BaseContentIndex } from './base-content-index';

/**
 * V8-optimized index for blocks
 * Maintains collection->name->locale lookups
 */
export class BlockIndex extends BaseContentIndex {
  constructor(locales: string[]) {
    super();
    // locales parameter kept for future use
  }
}
