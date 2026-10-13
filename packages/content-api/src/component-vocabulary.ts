/** Resource limits shared by build and runtime metadata readers; no renderer or platform dependencies. */
export const COMPONENT_MANIFEST_LIMITS = { bytes: 4_000_000, nodes: 100_000, depth: 64 } as const;
export const VOCABULARY_PAGE_LIMITS = { bytes: 256_000, nodes: 10_000, depth: 64 } as const;
export const VOCABULARY_SAMPLE_CAP = 50;
export const VOCABULARY_SAMPLE_NODES = 50_000;
export const VOCABULARY_OUTPUT_BYTES = 256_000;
export const VOCABULARY_READ_CONCURRENCY = 4;

/** Work and wire-size limits for JSON received by the metadata reader. */
export interface JsonLimits {
  nodes: number;
  bytes: number;
  depth: number;
}

export class JsonBudgetExceeded extends Error {
  constructor(
    public readonly reason: string,
    public readonly visitedNodes: number,
  ) {
    super(reason);
  }
}

/** Measures JSON without recursively serializing the entire input or expanding an unbounded traversal stack. */
export function measureJson(value: unknown, limits: JsonLimits): { nodes: number; bytes: number } {
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  let bytes = 0;
  const fail = (reason: string): never => {
    throw new JsonBudgetExceeded(reason, nodes);
  };
  const stringBytes = (text: string): number => {
    let count = 2; // JSON quotes.
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 34 || code === 92) count += 2;
      else if (code < 32) count += code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6;
      else if (code < 128) count++;
      else if (code < 2048) count += 2;
      else if (code >= 0xd800 && code <= 0xdbff) {
        const low = text.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          count += 4;
          i++;
        } else count += 6; // JSON escapes unpaired surrogates.
      } else if (code >= 0xdc00 && code <= 0xdfff) count += 6;
      else count += 3;
      if (count > limits.bytes) return fail('bytes');
    }
    return count;
  };
  while (pending.length) {
    const entry = pending.pop();
    if (!entry) break;
    if (++nodes > limits.nodes) fail('nodes');
    if (entry.depth > limits.depth) fail('depth');
    const current = entry.value;
    if (current === null) bytes += 4;
    else if (typeof current === 'string') bytes += stringBytes(current);
    else if (typeof current === 'boolean') bytes += current ? 4 : 5;
    else if (typeof current === 'number' && Number.isFinite(current)) bytes += String(current).length;
    else if (Array.isArray(current)) {
      if (nodes + pending.length + current.length > limits.nodes) fail('nodes');
      bytes += 2 + Math.max(0, current.length - 1);
      for (let i = current.length - 1; i >= 0; i--) pending.push({ value: current[i], depth: entry.depth + 1 });
    } else if (isRecord(current)) {
      const keys = Object.keys(current);
      if (nodes + pending.length + keys.length * 2 > limits.nodes) fail('nodes');
      nodes += keys.length;
      bytes += 2 + Math.max(0, keys.length - 1);
      for (const key of keys) {
        bytes += stringBytes(key) + 1;
        if (bytes > limits.bytes) fail('bytes');
        pending.push({ value: current[key], depth: entry.depth + 1 });
      }
    } else fail('non-json value');
    if (bytes > limits.bytes) fail('bytes');
  }
  return { nodes, bytes };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
