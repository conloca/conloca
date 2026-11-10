import { afterEach, describe, expect, it, setSystemTime } from 'bun:test';
import { createEditorReloadGate } from '../src/plugin-spa.js';

afterEach(() => {
  setSystemTime();
});

describe('createEditorReloadGate', () => {
  it('drops the reload of an own write however late it arrives', () => {
    const gate = createEditorReloadGate();
    gate.noteContentChange(true);
    setSystemTime(Date.now() + 5_000);
    expect(gate.shouldDrop({ type: 'full-reload', path: '*' })).toBe(true);
    expect(gate.shouldDrop({ type: 'full-reload', path: '*' })).toBe(false); // marks consumed
  });

  it('never drops the reload of a CLI write', () => {
    const gate = createEditorReloadGate();
    gate.noteContentChange(true);
    gate.noteContentChange(false);
    expect(gate.shouldDrop({ type: 'full-reload', path: '*' })).toBe(false);
  });

  it('never drops custom content events', () => {
    const gate = createEditorReloadGate();
    gate.noteContentChange(true);
    expect(gate.shouldDrop({ type: 'custom', event: 'conloca:content-update', data: {} })).toBe(false);
  });

  it('passes a reload no content change preceded', () => {
    expect(createEditorReloadGate().shouldDrop({ type: 'full-reload', path: '*' })).toBe(false);
  });
});
