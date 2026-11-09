import { describe, it } from 'bun:test';
import { MERGE_PROPERTIES } from './merge-properties.js';

describe('merge properties', () => {
  for (const p of MERGE_PROPERTIES) it(p.name, p.check);
});
