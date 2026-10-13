/** Reference-reading entry points; source resolution never depends on JSON materialization. */
export { resolveLiteralValue, resolveLiteralValueReading } from './literal.js';
export {
  type KeyLookup,
  lookUpKey,
  resolveCallExpression,
  resolveObjectLiteral,
  type SpreadSource,
} from './source-reference.js';
