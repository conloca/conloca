import { afterEach, describe, expect, it } from 'bun:test';
import {
  type EditorFlushResult,
  flushOpenEditor,
  isOpenEditorDirty,
  registerEditorFlushHandler,
} from './editor-flush.js';

afterEach(async () => {
  const drop = registerEditorFlushHandler(async () => ({ ok: true }));
  drop();
});

describe('editor-flush', () => {
  it('returns ok when no handler is registered', async () => {
    await expect(flushOpenEditor()).resolves.toEqual({ ok: true });
    expect(isOpenEditorDirty()).toBe(false);
  });

  it('invokes the registered handler and returns its result', async () => {
    const result: EditorFlushResult = { ok: false, message: 'conflict' };
    registerEditorFlushHandler(async () => result);
    await expect(flushOpenEditor()).resolves.toEqual(result);
  });

  it('reports isOpenEditorDirty from the registered getter', () => {
    let dirty = true;
    const unreg = registerEditorFlushHandler(async () => ({ ok: true }), { isDirty: () => dirty });
    expect(isOpenEditorDirty()).toBe(true);
    dirty = false;
    expect(isOpenEditorDirty()).toBe(false);
    unreg();
    expect(isOpenEditorDirty()).toBe(false);
  });

  it('unregister clears only the matching handler', async () => {
    const unregisterA = registerEditorFlushHandler(async () => ({ ok: false, message: 'a' }));
    unregisterA();
    await expect(flushOpenEditor()).resolves.toEqual({ ok: true });

    const unregisterB = registerEditorFlushHandler(async () => ({ ok: false, message: 'b' }));
    unregisterA();
    await expect(flushOpenEditor()).resolves.toEqual({ ok: false, message: 'b' });
    unregisterB();
    await expect(flushOpenEditor()).resolves.toEqual({ ok: true });
  });

  it('latest registration wins', async () => {
    registerEditorFlushHandler(async () => ({ ok: false, message: 'old' }));
    registerEditorFlushHandler(async () => ({ ok: true }));
    await expect(flushOpenEditor()).resolves.toEqual({ ok: true });
  });
});
