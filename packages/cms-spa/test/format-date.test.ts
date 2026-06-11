import { describe, expect, test } from 'bun:test';
import { formatDate, relativeTime } from '../src/utils/format-date';

// Entries can carry a missing/garbled `modified` (e.g. a manifest whose
// meta envelope was lost). `new Date(undefined)` is an Invalid Date and
// its toLocaleDateString() renders the literal string "Invalid Date" —
// these helpers must never leak that to the UI.

describe('formatDate', () => {
  test('renders an em dash for an invalid date', () => {
    expect(formatDate(new Date(Number.NaN))).toBe('—');
  });

  test('renders the locale date string for a valid date', () => {
    const d = new Date('2026-06-11T12:00:00Z');
    expect(formatDate(d)).toBe(d.toLocaleDateString());
  });
});

describe('relativeTime', () => {
  test('renders an em dash for an invalid date', () => {
    expect(relativeTime(new Date(Number.NaN))).toBe('—');
  });

  test('renders "just now" for the current instant', () => {
    expect(relativeTime(new Date())).toBe('just now');
  });

  test('renders minutes for recent dates', () => {
    expect(relativeTime(new Date(Date.now() - 5 * 60000))).toBe('5m ago');
  });

  test('renders hours within a day', () => {
    expect(relativeTime(new Date(Date.now() - 3 * 3600000))).toBe('3h ago');
  });

  test('renders days within a week', () => {
    expect(relativeTime(new Date(Date.now() - 2 * 86400000))).toBe('2d ago');
  });

  test('falls back to the locale date beyond a week', () => {
    const d = new Date(Date.now() - 30 * 86400000);
    expect(relativeTime(d)).toBe(d.toLocaleDateString());
  });
});
