/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { HintForm } from '../src/components/forms/HintForm.js';
import { pinTimeZone } from './time-zone.js';

afterEach(() => {
  cleanup();
});

describe('HintForm date fields', () => {
  // A fixed offset far from UTC, so local and UTC digits differ: UTC−12
  // (Etc/GMT+12; POSIX signs are reversed), where nobody lives.
  pinTimeZone('Etc/GMT+12');

  const hints = {
    date: { control: 'date' as const, label: 'Publish date' },
  };

  test('keeps zone-less picker digits as the author typed them', () => {
    render(<HintForm hints={hints} values={{ date: '2026-09-15T09:00' }} onChange={() => {}} />);

    const input = document.body.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(input.value).toBe('2026-09-15T09:00');
  });

  test('an ISO instant shows UTC hours, since the stored zone-less digits mean UTC', () => {
    // Showing local hours here would rewrite 09:00Z to the local 21:00 of the
    // day before, and saving would move the date.
    render(<HintForm hints={hints} values={{ date: '2026-09-15T09:00:00.000Z' }} onChange={() => {}} />);

    const input = document.body.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(input.value).toBe('2026-09-15T09:00');
  });

  test('saves the picked digits as a full UTC timestamp a date-time validator accepts', () => {
    const saved: Record<string, unknown>[] = [];
    render(<HintForm hints={hints} values={{}} onChange={(values) => saved.push(values)} />);

    const input = document.body.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-09-15T09:00' } });

    expect(saved.at(-1)?.date).toBe('2026-09-15T09:00:00.000Z');
    expect(Number.isNaN(Date.parse(String(saved.at(-1)?.date)))).toBe(false);
  });
});
