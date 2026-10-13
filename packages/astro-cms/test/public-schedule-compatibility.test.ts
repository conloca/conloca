import { expect, test } from 'bun:test';
import * as publicApi from '../src/index.js';

for (const name of ['isPublished', 'toDate']) {
  test(`the module entrypoint retains the existing ${name} schedule helper`, () => {
    expect(publicApi).toHaveProperty(name, expect.any(Function));
  });
}

const past = '2000-01-01T00:00:00.000Z';
const future = '2999-01-01T00:00:00.000Z';

test('the legacy predicate preserves publication decisions without accepting an array index as the clock', () => {
  const visible = { publishAt: past, unpublishAt: future };
  const planned = { publishAt: future };
  const expired = { unpublishAt: past };
  expect([visible, planned, expired, {}].filter(publicApi.isPublished)).toEqual([visible, {}]);
});

test('the legacy predicate treats missing and unreadable dates like the canonical schedule reader', () => {
  expect(publicApi.isPublished({ publishAt: null, unpublishAt: undefined })).toBe(true);
  expect(publicApi.isPublished({ publishAt: 'not a date', unpublishAt: '' })).toBe(true);
  expect(publicApi.isPublished({ publishAt: new Date(past), unpublishAt: new Date(future) })).toBe(true);
});

test('the date helper retains existing Date values and rejects unreadable strings', () => {
  const date = new Date(past);
  expect(publicApi.toDate(date)).toBe(date);
  expect(publicApi.toDate(past)).toEqual(date);
  for (const value of [null, undefined, '', 'not a date']) expect(publicApi.toDate(value)).toBeUndefined();
});
