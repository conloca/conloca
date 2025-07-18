# V8 Byte Scanning Optimization Guide

This guide documents best practices for implementing high-performance byte scanning and streaming transforms in
JavaScript, based on V8 engine optimization patterns.

## Key Findings

### SIMD Support in V8

**Current State:**

- V8 does **not** perform automatic vectorization of JavaScript loops
- The deprecated SIMD.js proposal was abandoned in favor of WebAssembly SIMD
- Native JavaScript has no direct access to SIMD instructions

**WebAssembly SIMD:**

- The only way to use SIMD instructions in V8 is through WebAssembly
- Requires compiling C/C++ code with `-msimd128` flag
- Can achieve 5x performance improvements (e.g., 3 FPS → 15 FPS in hand-tracking)

**References:**

- [Fast, parallel applications with WebAssembly SIMD · V8](https://v8.dev/features/simd)
- [V8 developer confirmation: no auto-vectorization](https://stackoverflow.com/questions/63864497/is-there-any-way-to-get-node-js-and-v8-to-automatically-vectorize-simple-loops)
- [WebAssembly SIMD implementation guide](https://emscripten.org/docs/porting/simd.html)

## V8 Optimization Patterns for Byte Scanning

### 1. Type Stability

V8 optimizes based on type feedback. Maintaining consistent types prevents deoptimization.

```typescript
// ✅ GOOD: Monomorphic - always Uint8Array
function scanBytes(buffer: Uint8Array, target: number): number {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === target) return i;
  }
  return -1;
}

// ❌ BAD: Polymorphic - causes deoptimization
function scan(buffer: any[] | Uint8Array, target: any) { ... }
```

**Reference:**
[Understanding the V8 Engine: Optimizing JavaScript](https://dev.to/parthchovatiya/understanding-the-v8-engine-optimizing-javascript-for-peak-performance-1c9b)

### 2. Array Access Patterns

#### Avoid Out-of-Bounds Access

Out-of-bounds reads trigger expensive prototype chain lookups and permanently deoptimize the load site.

```typescript
// ✅ GOOD: Always bounds-checked
const len = buffer.length;
for (let i = 0; i < len; i++) {
  const byte = buffer[i]; // Safe
}

// ❌ BAD: Potential out-of-bounds
if (buffer[i + 10]) { ... } // Permanently slow after first OOB
```

#### Packed vs Holey Arrays

V8 tracks whether arrays have holes and optimizes packed arrays more aggressively.

```typescript
// ✅ GOOD: Packed array
const bytes = new Uint8Array(100); // Always packed

// ❌ BAD: Holey array
const arr = [1, 2, , , 5]; // Has holes, slower operations
```

**References:**

- [Elements kinds in V8](https://v8.dev/blog/elements-kinds)
- [Mastering JavaScript high performance in V8](https://marcradziwill.com/blog/mastering-javascript-high-performance/)

### 3. Loop Optimization

#### Traditional For Loops

Imperative loops are faster than functional methods for performance-critical code.

```typescript
// ✅ GOOD: Single pass, no allocations
let sum = 0;
for (let i = 0; i < buffer.length; i++) {
  if (buffer[i] > 128) sum += buffer[i];
}

// ❌ BAD: Multiple passes, intermediate arrays
const sum = buffer.filter((b) => b > 128).reduce((a, b) => a + b, 0);
```

**Reference:** [Optimizing Javascript for fun and for profit](https://romgrk.com/posts/optimizing-javascript)

### 4. Scanner Optimization Techniques

V8's own scanner uses these patterns for 2.1× performance improvement:

```typescript
// ✅ GOOD: Early returns in separate methods
function skipWhitespace(buffer: Uint8Array, start: number): number {
  let i = start;
  while (i < buffer.length) {
    const byte = buffer[i];
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      return i; // Early return when non-whitespace found
    }
    i++;
  }
  return i;
}

// ✅ GOOD: Use TypedArray methods when available
const nextQuote = buffer.indexOf(0x22, currentPos);
if (nextQuote !== -1) {
  // Process chunk up to quote
}
```

**Reference:** [Blazingly fast parsing, part 1: optimizing the scanner · V8](https://v8.dev/blog/scanner)

## Streaming Transform Best Practices

### 1. Minimize Update Calls

Batch operations to reduce JavaScript/native boundary crossings:

```typescript
// ✅ GOOD: Batch updates
class OptimizedStreamTransform {
  updateBuffer(buffer: Uint8Array, start: number, end: number) {
    let i = start;

    while (i < end) {
      // Find next run of bytes to process
      const runStart = i;
      while (i < end && shouldInclude(buffer[i])) {
        i++;
      }

      // Send entire run at once
      if (i > runStart) {
        this.downstream.update(buffer.subarray(runStart, i));
      }

      // Skip bytes that shouldn't be included
      while (i < end && !shouldInclude(buffer[i])) {
        i++;
      }
    }
  }
}

// ❌ BAD: Individual byte updates
for (let i = 0; i < buffer.length; i++) {
  if (shouldInclude(buffer[i])) {
    this.downstream.update(new Uint8Array([buffer[i]]));
  }
}
```

### 2. Zero-Allocation Patterns

Use buffer views instead of creating new arrays:

```typescript
// ✅ GOOD: Zero allocations
this.downstream.update(buffer.subarray(start, end)); // View, no copy

// ❌ BAD: Allocates new array
const chunk = Array.from(buffer.slice(start, end));
this.downstream.update(new Uint8Array(chunk));
```

### 3. State Machine Optimization

Keep state machines simple and branch-predictable:

```typescript
// ✅ GOOD: Simple state with predictable branches
class JsonWhitespaceSkipper {
  private inString = false;
  private escaped = false;

  processByte(byte: number): boolean {
    if (this.inString) {
      // Predictable: always include bytes in strings
      if (!this.escaped && byte === 0x5c) this.escaped = true;
      else if (!this.escaped && byte === 0x22) this.inString = false;
      else if (this.escaped) this.escaped = false;
      return true;
    } else {
      // Predictable: check for quote or whitespace
      if (byte === 0x22) {
        this.inString = true;
        return true;
      }
      return !isWhitespace(byte);
    }
  }
}
```

### 4. Manual Loop Unrolling (Use Sparingly)

For extremely hot paths, careful unrolling can help:

```typescript
// ✅ GOOD: Process 4 bytes at a time when beneficial
function findNextWhitespace(buffer: Uint8Array, start: number): number {
  let i = start;
  const len = buffer.length;

  // Process 4 bytes at a time
  while (i + 4 <= len) {
    if (
      buffer[i] === 0x20 ||
      buffer[i] === 0x09 ||
      buffer[i + 1] === 0x20 ||
      buffer[i + 1] === 0x09 ||
      buffer[i + 2] === 0x20 ||
      buffer[i + 2] === 0x09 ||
      buffer[i + 3] === 0x20 ||
      buffer[i + 3] === 0x09
    ) {
      // Found whitespace, scan exact position
      break;
    }
    i += 4;
  }

  // Handle remainder
  while (i < len) {
    if (buffer[i] === 0x20 || buffer[i] === 0x09) return i;
    i++;
  }

  return -1;
}
```

## Performance Measurement

Always measure performance impact of optimizations:

```typescript
// Use high-resolution timing
const start = performance.now();
processBuffer(buffer);
const elapsed = performance.now() - start;

// For hot paths, use V8 profiler
// node --prof your-script.js
// node --prof-process isolate-*.log
```

## When to Consider WebAssembly

Consider WebAssembly with SIMD only when:

1. Byte scanning is a proven bottleneck (measured, not assumed)
2. Processing large buffers (MB+ size)
3. The complexity overhead is justified
4. Native TypedArray methods are insufficient

Example WebAssembly SIMD approach:

```c
// scan.c - Compile with emcc -msimd128 -O3
#include <wasm_simd128.h>

int find_whitespace_simd(uint8_t* buffer, int len) {
  v128_t spaces = wasm_i8x16_splat(0x20);
  v128_t tabs = wasm_i8x16_splat(0x09);

  for (int i = 0; i < len; i += 16) {
    v128_t chunk = wasm_v128_load(&buffer[i]);
    v128_t is_space = wasm_i8x16_eq(chunk, spaces);
    v128_t is_tab = wasm_i8x16_eq(chunk, tabs);
    v128_t is_whitespace = wasm_v128_or(is_space, is_tab);

    if (wasm_v128_any_true(is_whitespace)) {
      // Found whitespace in this chunk
      // ... find exact position
    }
  }
  return -1;
}
```

## Summary

For optimal byte scanning performance in V8:

1. **Keep types monomorphic** - Always use Uint8Array, never mixed types
2. **Batch operations** - Process contiguous runs to minimize API calls
3. **Use TypedArray methods** - indexOf() is optimized for byte searching
4. **Avoid deoptimization triggers** - No out-of-bounds access, consistent object shapes
5. **Prefer imperative code** - Traditional for loops over functional methods
6. **Zero allocations** - Use subarray() views instead of creating new buffers
7. **Consider WebAssembly SIMD** - Only for proven bottlenecks with large data

Remember: V8 is constantly evolving. Always profile your specific use case and verify optimizations have the expected
impact.
