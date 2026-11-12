import { describe, expect, it } from 'bun:test';
import { mergeSequences } from '../../src/merge/sequences.js';

const item = (label: string) => ({ label });
const [a, b, c] = [item('a'), item('b'), item('c')];
const merge = (base: { label: string }[], ours: { label: string }[], theirs: { label: string }[]) =>
  mergeSequences(base, ours, theirs);

describe('mergeSequences', () => {
  it("keeps a teammate's edit on the same item when the user removes one before it", () => {
    expect(merge([a, b, c], [b, c], [a, b, item('C')])).toEqual([b, item('C')]);
  });

  it("keeps a teammate's edit on the same item when the user inserts one before it", () => {
    expect(merge([a, b, c], [a, item('x'), b, c], [a, b, item('C')])).toEqual([a, item('x'), b, item('C')]);
  });

  it('takes the user’s value when both edit the same item, without a duplicate', () => {
    expect(merge([a, b, c], [a, b, item('U')], [a, b, item('T')])).toEqual([a, b, item('U')]);
  });

  it("keeps a teammate's insert in place when the user removes the item after it", () => {
    expect(merge([a, b, c], [a, c], [a, item('y'), b, c])).toEqual([a, item('y'), c]);
  });

  it("holds a teammate's removal, unless the user edited that item", () => {
    expect(merge([a, b, c], [a, b, c], [a, c])).toEqual([a, c]);
    expect(merge([a, b, c], [a, item('B'), c], [a, c])).toEqual([a, item('B'), c]);
  });

  it('leaves an item the user removed removed, though a teammate edited it', () => {
    expect(merge([a, b, c], [a, c], [a, item('B'), c])).toEqual([a, c]);
  });

  it('keeps edits to neighbouring items from both sides', () => {
    expect(merge([a, b, c], [a, item('B'), c], [a, b, item('C')])).toEqual([a, item('B'), item('C')]);
  });

  it("keeps both sides' inserts at one point, the teammate's first", () => {
    expect(merge([a], [a, item('u')], [a, item('t')])).toEqual([a, item('t'), item('u')]);
  });
});

const x = (label: string, kind = 'k') => ({ label, kind });
const merge3 = (base: { label: string; kind: string }[], ours: typeof base, theirs: typeof base) =>
  mergeSequences(base, ours, theirs);

describe('mergeSequences, per item', () => {
  it("keeps a teammate's edit to the next item when both edit one", () => {
    const [pa, pb, pc] = [x('a'), x('b'), x('c')];
    expect(merge3([pa, pb, pc], [pa, x('B-user'), pc], [pa, x('B-team'), x('C-team')])).toEqual([
      pa,
      x('B-user'),
      x('C-team'),
    ]);
  });

  it("holds a teammate's removal of the next item when the user edits one of the two removed", () => {
    const [pa, pb, pc] = [x('a'), x('b'), x('c')];
    expect(merge3([pa, pb, pc], [pa, x('B-user'), pc], [pa])).toEqual([pa, x('B-user')]);
  });

  it("keeps a teammate's insert beside an item both edited", () => {
    const [pa, pb, pc] = [x('a'), x('b'), x('c', 'old')];
    const theirs = [pa, pb, x('y', 'new'), x('C-team', 'old')];
    expect(merge3([pa, pb, pc], [pa, pb, x('C-user', 'old')], theirs)).toEqual([
      pa,
      pb,
      x('y', 'new'),
      x('C-user', 'old'),
    ]);
  });

  it("keeps a teammate's edit to the second of two equal items when the user removes the first", () => {
    const pa = x('a');
    expect(merge3([pa, pa], [pa], [pa, x('A-team')])).toEqual([x('A-team')]);
  });
});

const one = (label: string) => ({ label });

describe('mergeSequences, moves and one-field items', () => {
  it("moves the user's edit with the item when a teammate moves it, without a duplicate", () => {
    const [ma, mb, mc] = [x('a'), x('b'), x('c')];
    expect(merge3([ma, mb, mc], [x('A-user'), mb, mc], [mb, mc, ma])).toEqual([mb, mc, x('A-user')]);
  });

  it("keeps a teammate's edit to the item the user moves", () => {
    const [ma, mb, mc] = [x('a'), x('b'), x('c')];
    expect(merge3([ma, mb, mc], [mb, mc, ma], [x('A-team'), mb, mc])).toEqual([mb, mc, x('A-team')]);
  });

  it('keeps one version of a one-field item both edited, beside a teammate insert', () => {
    const base = [one('a'), one('b'), one('c')];
    expect(
      mergeSequences(base, [one('a'), one('b'), one('c-user')], [one('a'), one('b'), one('y'), one('c-team')]),
    ).toEqual([one('a'), one('b'), one('y'), one('c-user')]);
  });
});
