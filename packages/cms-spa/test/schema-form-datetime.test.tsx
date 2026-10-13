/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { z } from 'zod';
import { SchemaForm } from '../src/components/forms/SchemaForm.js';
import { pinTimeZone } from './time-zone.js';

afterEach(() => {
  cleanup();
});

describe('SchemaForm datetime-local fields', () => {
  // CI often runs TZ=UTC, which makes UTC-sliced values look correct. Pin
  // UTC−12 as a fixed offset (Etc/GMT+12; POSIX signs are reversed), where nobody lives.
  pinTimeZone('Etc/GMT+12');

  const schema = z.object({
    publishedAt: z.coerce.date().optional().describe('When this goes live'),
  });

  test('a stored instant shows the authors local clock, not UTC', () => {
    // Data collections round-trip dates as Date objects or ISO strings with Z.
    // datetime-local is wall-clock with no zone. Filling it from toISOString()
    // shows UTC hours, so a 17:00 local clock (the day before) comes back as 05:00.
    const stored = new Date('2026-09-15T05:00:00.000Z');
    render(<SchemaForm schema={schema} values={{ publishedAt: stored }} onChange={() => {}} />);

    const input = document.body.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('2026-09-14T17:00');
  });

  test('an ISO string with a zone shows the same local clock', () => {
    render(<SchemaForm schema={schema} values={{ publishedAt: '2026-09-15T05:00:00.000Z' }} onChange={() => {}} />);

    const input = document.body.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(input.value).toBe('2026-09-14T17:00');
  });
});
