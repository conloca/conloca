import type { Node, ObjectLiteralExpression } from 'ts-morph';
import {
  type FieldSources,
  readField as projectField,
  readFieldSet as projectFieldSet,
  WRITTEN_DOWN,
} from './field-projection.js';
import { readFieldBuilderCall } from './read-wrapper.js';

export { carryKey, type FieldSetReading, type FieldSources } from './field-projection.js';

/** Public reader entry points retain builder support without a projection/wrapper import cycle. */
export function readField(node: ObjectLiteralExpression, depth = 0, sources: FieldSources = WRITTEN_DOWN) {
  return projectField(node, depth, { ...sources, builder: sources.builder ?? readFieldBuilderCall });
}

export function readFieldSet(node: Node | undefined, depth = 0, sources: FieldSources = WRITTEN_DOWN) {
  return projectFieldSet(node, depth, { ...sources, builder: sources.builder ?? readFieldBuilderCall });
}
