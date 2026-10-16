/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { SchemaForm } from '../src/components/forms/SchemaForm.js';
import { publishedAtFields } from './fixtures/typia/host-schemas.js';
import { pinTimeZone } from './time-zone.js';

afterEach(() => {
  cleanup();
});

describe('SchemaForm datetime-local fields', () => {
  // CI often runs TZ=UTC, which makes UTC-sliced values look correct. Pin
  // UTC−12 as a fixed offset (Etc/GMT+12; POSIX signs are reversed), where nobody lives.
  pinTimeZone('Etc/GMT+12');

  const schema = publishedAtFields;

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

  test('an edited date is saved as the instant the local clock names, which the host validator accepts', () => {
    // The picker's own value has no zone or seconds, which a `Format<'date-time'>` validator rejects.
    let saved: Record<string, unknown> = {};
    const save = (values: Record<string, unknown>) => {
      saved = values;
    };
    render(<SchemaForm schema={schema} values={{}} onChange={save} />);

    const input = document.body.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-09-14T17:00' } });

    expect(saved).toEqual({ publishedAt: '2026-09-15T05:00:00.000Z' });
    expect(schema.validate(saved).success).toBe(true);
  });

  test('clearing the date saves no value', () => {
    let saved: Record<string, unknown> = {};
    const save = (values: Record<string, unknown>) => {
      saved = values;
    };
    render(<SchemaForm schema={schema} values={{ publishedAt: '2026-09-15T05:00:00.000Z' }} onChange={save} />);

    const input = document.body.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });

    expect(saved).toEqual({ publishedAt: undefined });
  });
});
