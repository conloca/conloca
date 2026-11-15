import { describe, expect, test } from 'bun:test';
import { restoredMessage, versionReasonLabel } from './version-copy.js';

describe('versionReasonLabel', () => {
  test.each([
    ['discard', 'Discarded'],
    ['reset', 'Discarded by a reset'],
    ['delete', 'Deleted'],
    ['pick', 'Not chosen in a clash'],
    ['overwrite', 'Overwritten while editing'],
    ['superseded', 'Older GitHub value'],
    ['upstream', 'Replaced by a GitHub push'],
    ['stale', 'Unsynced edits from an older tab'],
    ['unbased', 'Saved by an older editor'],
    ['refused', 'Not saved after an access change'],
    ['clashed', 'Kept from a clash'],
    ['something-new', 'Saved copy'],
    ['toString', 'Saved copy'],
  ])('%s reads %s', (reason, label) => {
    expect(versionReasonLabel(reason)).toBe(label);
  });
});

describe('restoredMessage', () => {
  test('names the page alone when nothing was kept', () => {
    expect(restoredMessage('Pricing', [])).toBe('Restored Pricing.');
  });
  test('counts fields that kept their newer value, singular and plural', () => {
    expect(restoredMessage('Pricing', ['title'])).toBe('Restored Pricing. 1 field kept its newer value.');
    expect(restoredMessage('Pricing', ['a', 'b'])).toBe('Restored Pricing. 2 fields kept their newer value.');
  });
});
