import { describe, expect, it } from 'bun:test';
import { readLiveHello, readLiveMessage, readLiveStatus } from './messages.js';

const PAGE = { site: 'web', id: 'p1', locale: 'en' };

describe('live messages', () => {
  it('reads an overwritten message with or without a snapshot id', () => {
    const m = {
      type: 'conloca:overwritten',
      ...PAGE,
      anchor: 'content[id=h1].props.title',
      value: 'Old',
      byUserId: 'u2',
      byName: 'Maria',
      snapshotId: 's1',
    };
    expect<unknown>(readLiveMessage(m)).toEqual(m);
    const { snapshotId: _, ...unrestorable } = m;
    expect<unknown>(readLiveMessage(unrestorable)).toEqual(unrestorable);
    expect(readLiveMessage({ ...m, snapshotId: 7 })).toBeUndefined();
  });

  it('reads a too-large refusal and rejects unknown types and statuses', () => {
    const r = { type: 'conloca:refused', ...PAGE, status: 413, code: 'too-large' };
    expect<unknown>(readLiveMessage(r)).toEqual(r);
    expect(readLiveMessage({ type: 'conloca:other', ...PAGE })).toBeUndefined();
    expect(readLiveMessage({ ...r, status: 500 })).toBeUndefined();
    expect(readLiveMessage({ ...r, code: 'nope' })).toBeUndefined();
  });

  it('reads a busy refusal', () => {
    const r = { type: 'conloca:refused', ...PAGE, status: 503, code: 'busy' };
    expect<unknown>(readLiveMessage(r)).toEqual(r);
  });

  it('reads merged, conflict and discarded messages and drops unknown fields', () => {
    const merged = { type: 'conloca:merged', ...PAGE, source: 'github', commit: 'abc', byName: 'Bot' };
    expect<unknown>(readLiveMessage({ ...merged, extra: 1 })).toEqual(merged);
    expect(readLiveMessage({ ...merged, source: 'ftp' })).toBeUndefined();
    const conflict = { type: 'conloca:conflict', ...PAGE, open: true, anchors: ['a'] };
    expect<unknown>(readLiveMessage(conflict)).toEqual(conflict);
    expect(readLiveMessage({ ...conflict, anchors: [1] })).toBeUndefined();
    // The server's frame to a tab refused as stale names nobody; the one to tabs open at the discard names who did it.
    const discarded = { type: 'conloca:discarded', generation: 4, ...PAGE };
    expect<unknown>(readLiveMessage(discarded)).toEqual(discarded);
    const named = { ...discarded, byName: 'Maria', byUserId: 'u2', staleSnapshotId: 's1' };
    expect<unknown>(readLiveMessage(named)).toEqual(named);
    expect(readLiveMessage({ ...discarded, byName: 7 })).toBeUndefined();
    expect(readLiveMessage({ ...discarded, generation: '4' })).toBeUndefined();
    expect(readLiveMessage({ ...discarded, site: undefined })).toBeUndefined();
  });

  it('reads a hello only with a generation and an access mode', () => {
    const h = { type: 'conloca:live-hello', ...PAGE, generation: 2, user: { id: 'u1', name: 'A' } };
    expect<unknown>(readLiveHello({ ...h, access: 'read' })).toEqual({ ...h, access: 'read' });
    expect(readLiveHello(h)).toBeUndefined();
    expect(readLiveHello({ ...h, access: 'write', user: { id: 'u1' } })).toBeUndefined();
  });

  it("reads the server's update cap from a hello, and drops one that is not a positive integer", () => {
    const h = { type: 'conloca:live-hello', ...PAGE, generation: 2, user: { id: 'u1', name: 'A' }, access: 'write' };
    expect<unknown>(readLiveHello({ ...h, updateMaxBytes: 262_144 })).toEqual({ ...h, updateMaxBytes: 262_144 });
    for (const bad of [0, -1, 1.5, '262144', null])
      expect<unknown>(readLiveHello({ ...h, updateMaxBytes: bad })).toEqual(h);
  });

  it('reads a status with or without a read-only reason', () => {
    const s = { connection: 'connected', pending: false, persisted: true, readOnly: null, deletedExport: null };
    expect<unknown>(readLiveStatus(s)).toEqual(s);
    const ro = { ...s, connection: 'read-only', readOnly: { status: 413, code: 'update-too-large-unsaved' } };
    expect<unknown>(readLiveStatus(ro)).toEqual(ro);
    expect(readLiveStatus({ ...s, connection: 'gone' })).toBeUndefined();
  });

  it('reads a status from a sender that predates the deleted-export field as naming no deletion', () => {
    const { deletedExport: _, ...older } = {
      connection: 'connected',
      pending: false,
      persisted: true,
      readOnly: null,
      deletedExport: null,
    };
    expect<unknown>(readLiveStatus(older)).toEqual({ ...older, deletedExport: null });
  });
});
