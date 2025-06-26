#!/usr/bin/env bun
import { xxh3 } from '@node-rs/xxhash';
import { createHash } from 'crypto';
import { JsonWhitespaceSkippingView as OptimizedImplementation } from './src/etag-utils';

// Simple byte-by-byte implementation (current version for comparison)
class SimpleJsonWhitespaceSkippingView {
  private inString = false;
  private escaped = false;
  private singleByte = new Uint8Array(1);

  constructor(private downstream: { update(data: Uint8Array): void }) {}

  updateBuffer(buffer: Uint8Array, start = 0, end = buffer.length): void {
    let pos = start;
    let runStart = start;

    while (pos < end) {
      const byte = buffer[pos];
      let shouldInclude = false;

      if (this.inString) {
        // Inside string: always include
        shouldInclude = true;

        if (this.escaped) {
          this.escaped = false;
        } else if (byte === 0x5c) {
          // backslash
          this.escaped = true;
        } else if (byte === 0x22) {
          // quote - end of string
          this.inString = false;
        }
      } else {
        // Outside string
        if (byte === 0x22) {
          // quote - start of string
          this.inString = true;
          shouldInclude = true;
        } else if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
          // Not whitespace
          shouldInclude = true;
        }
      }

      if (shouldInclude) {
        // Continue the run
        pos++;
      } else {
        // End of run - send what we have
        if (pos > runStart) {
          this.downstream.update(buffer.subarray(runStart, pos));
        }
        pos++;
        runStart = pos;
      }
    }

    // Send any remaining bytes
    if (pos > runStart) {
      this.downstream.update(buffer.subarray(runStart, pos));
    }
  }

  reset(): void {
    this.inString = false;
    this.escaped = false;
  }
}

// Generate test data with different characteristics
function generateTestData(type: 'mixed' | 'string-heavy' | 'data-heavy'): Uint8Array {
  let obj: any;

  switch (type) {
    case 'mixed':
      obj = {
        metadata: {
          id: 'doc-12345',
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          tags: ['performance', 'test', 'optimization'],
        },
        content: {
          sections: Array(50)
            .fill(0)
            .map((_, i) => ({
              id: `section-${i}`,
              title: `Section ${i}`,
              text: `This is paragraph ${i}. It contains some "quoted text" and escaped content like \\"this\\".`.repeat(
                5,
              ),
              data: Array(10)
                .fill(0)
                .map((_, j) => ({ key: j, value: j * 2 })),
            })),
        },
      };
      break;

    case 'string-heavy':
      obj = {
        documents: Array(20)
          .fill(0)
          .map((_, i) => ({
            id: i,
            title: `Document ${i}`,
            content: 'x'.repeat(10000), // 10KB strings
            description: 'y'.repeat(5000), // 5KB strings
            escaped: `Text with \\"quotes\\" and \\\\backslashes\\\\ repeated. `.repeat(100),
          })),
      };
      break;

    case 'data-heavy':
      obj = {
        metrics: Array(10000)
          .fill(0)
          .map((_, i) => i),
        flags: Array(5000)
          .fill(0)
          .map((_, i) => i % 2 === 0),
        objects: Array(1000)
          .fill(0)
          .map((_, i) => ({
            id: i,
            value: Math.random(),
            flag: i % 3 === 0,
          })),
      };
      break;
  }

  return new TextEncoder().encode(JSON.stringify(obj, null, 2));
}

// Statistical benchmark with confidence intervals
interface BenchmarkResult {
  name: string;
  median: number;
  mean: number;
  stdDev: number;
  confidenceInterval: [number, number];
  samples: number;
}

function runBenchmark(
  name: string,
  ViewClass: any,
  data: Uint8Array,
  hasher: 'sha256' | 'xxhash',
  options: { warmupRuns?: number; testRuns?: number } = {},
): BenchmarkResult {
  const { warmupRuns = 50, testRuns = 100 } = options;

  // Warmup
  for (let i = 0; i < warmupRuns; i++) {
    if (hasher === 'sha256') {
      const hash = createHash('sha256');
      const view = new ViewClass(hash);
      view.updateBuffer(data);
      hash.digest();
    } else {
      const hash = xxh3.Xxh3.withSeed(0n);
      const view = new ViewClass(hash);
      view.updateBuffer(data);
      hash.digest();
    }
  }

  // Collect samples
  const times: number[] = [];

  for (let i = 0; i < testRuns; i++) {
    // GC every 10 runs to reduce variance
    if (i % 10 === 0 && globalThis.Bun?.gc) {
      Bun.gc(true);
    }

    const start = performance.now();

    if (hasher === 'sha256') {
      const hash = createHash('sha256');
      const view = new ViewClass(hash);
      view.updateBuffer(data);
      hash.digest();
    } else {
      const hash = xxh3.Xxh3.withSeed(0n);
      const view = new ViewClass(hash);
      view.updateBuffer(data);
      hash.digest();
    }

    const elapsed = performance.now() - start;
    times.push(elapsed);
  }

  // Calculate statistics
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const variance = times.reduce((sum, t) => sum + (t - mean) ** 2, 0) / times.length;
  const stdDev = Math.sqrt(variance);

  // 95% confidence interval
  const stderr = stdDev / Math.sqrt(times.length);
  const marginOfError = 1.96 * stderr;
  const confidenceInterval: [number, number] = [mean - marginOfError, mean + marginOfError];

  return {
    name,
    median,
    mean,
    stdDev,
    confidenceInterval,
    samples: times.length,
  };
}

// Main benchmark
console.log('JSON Whitespace Skipping Optimization Benchmark');
console.log('==============================================\n');

// Verify correctness first
console.log('Correctness Verification:');
console.log('------------------------');
const testCases = [
  '{"simple": "test"}',
  '{"escaped": "test \\"quotes\\" here"}',
  '{"backslashes": "test \\\\ more \\\\\\\\ backslashes"}',
  '{"complex": "multiple \\\\\\"escaped\\\\\\" sequences"}',
];

let allCorrect = true;
for (const testCase of testCases) {
  const data = new TextEncoder().encode(testCase);

  const hash1 = createHash('sha256');
  const view1 = new SimpleJsonWhitespaceSkippingView(hash1);
  view1.updateBuffer(data);
  const result1 = hash1.digest('hex');

  const hash2 = createHash('sha256');
  const view2 = new OptimizedImplementation(hash2);
  view2.updateBuffer(data);
  const result2 = hash2.digest('hex');

  const matches = result1 === result2;
  allCorrect = allCorrect && matches;
  console.log(`${matches ? '✅' : '❌'} ${testCase}`);
}

if (!allCorrect) {
  console.error('\n❌ Correctness check failed! Aborting benchmark.');
  process.exit(1);
}
console.log('\n✅ All correctness tests passed!\n');

// Run benchmarks
const dataTypes = [
  { name: 'Mixed content', type: 'mixed' as const },
  { name: 'String-heavy', type: 'string-heavy' as const },
  { name: 'Data-heavy', type: 'data-heavy' as const },
];

const implementations = [
  { name: 'Simple (byte-by-byte)', Class: SimpleJsonWhitespaceSkippingView },
  { name: 'Optimized (indexOf)', Class: OptimizedImplementation },
];

for (const { name: dataName, type } of dataTypes) {
  const testData = generateTestData(type);
  console.log(`\n${dataName} (${testData.length.toLocaleString()} bytes):`);
  console.log('='.repeat(60));

  // SHA256 benchmark
  console.log('\nSHA256:');
  const sha256Results: BenchmarkResult[] = [];

  for (const { name, Class } of implementations) {
    const result = runBenchmark(name, Class, testData, 'sha256');
    sha256Results.push(result);

    console.log(`  ${name}:`);
    console.log(`    Median: ${result.median.toFixed(3)}ms`);
    console.log(`    Mean:   ${result.mean.toFixed(3)}ms ± ${result.stdDev.toFixed(3)}ms`);
    console.log(`    95% CI: [${result.confidenceInterval[0].toFixed(3)}, ${result.confidenceInterval[1].toFixed(3)}]`);
  }

  // Calculate speedup and statistical significance
  const baseline = sha256Results[0];
  const optimized = sha256Results[1];
  const speedup = baseline.median / optimized.median;

  // Check if confidence intervals overlap
  const significant = baseline.confidenceInterval[0] > optimized.confidenceInterval[1];

  console.log(
    `\n  Speedup: ${speedup.toFixed(2)}x (${significant ? 'statistically significant' : 'not statistically significant'})`,
  );

  // xxHash benchmark
  console.log('\nxxHash:');
  const xxhashResults: BenchmarkResult[] = [];

  for (const { name, Class } of implementations) {
    const result = runBenchmark(name, Class, testData, 'xxhash');
    xxhashResults.push(result);
    console.log(`  ${name}: ${result.median.toFixed(3)}ms`);
  }

  const xxSpeedup = xxhashResults[0].median / xxhashResults[1].median;
  console.log(`  Speedup: ${xxSpeedup.toFixed(2)}x`);
}

// Summary
console.log('\n\nSummary:');
console.log('========');
console.log('The optimized implementation uses indexOf() to skip through string content');
console.log('instead of checking every byte. This is especially beneficial for JSON with');
console.log('long string values while maintaining identical output to the current implementation.');
