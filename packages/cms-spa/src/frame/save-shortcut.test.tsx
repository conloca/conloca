import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderHook } from '@testing-library/react';
import { configureUI } from '../ui-config.js';
import { isSaveCombo, useCanvasSaveShortcut } from './save-shortcut.js';

let doc: Document;
let forwarded: KeyboardEvent[];
const onWindowKeydown = (event: KeyboardEvent) => forwarded.push(event);

beforeEach(() => {
  doc = document.implementation.createHTMLDocument();
  forwarded = [];
  window.addEventListener('keydown', onWindowKeydown);
});

afterEach(() => {
  window.removeEventListener('keydown', onWindowKeydown);
  configureUI({});
});

function pressSave(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true });
  doc.dispatchEvent(event);
  return event;
}

describe('Cmd/Ctrl+S inside the editing canvas', () => {
  test('a save combo is Cmd or Ctrl with s, in either case', () => {
    expect(isSaveCombo(new KeyboardEvent('keydown', { key: 's', metaKey: true }))).toBe(true);
    expect(isSaveCombo(new KeyboardEvent('keydown', { key: 'S', ctrlKey: true }))).toBe(true);
    expect(isSaveCombo(new KeyboardEvent('keydown', { key: 's' }))).toBe(false);
    expect(isSaveCombo(new KeyboardEvent('keydown', { key: 'a', metaKey: true }))).toBe(false);
  });

  test('in a parent frame it is kept from the browser and handed to the editor window', () => {
    configureUI({ memoryRouter: { initialPath: '/pages', onNavigate: () => {}, subscribe: () => () => {} } });
    renderHook(() => useCanvasSaveShortcut(doc));

    const event = pressSave();

    expect(event.defaultPrevented).toBe(true);
    expect(forwarded.length).toBe(1);
    expect(forwarded[0]?.key).toBe('s');
    expect(forwarded[0]?.ctrlKey).toBe(true);
    expect(forwarded[0]?.cancelable).toBe(true);
  });

  test('outside a parent frame nothing is prevented or forwarded', () => {
    renderHook(() => useCanvasSaveShortcut(doc));

    const event = pressSave();

    expect(event.defaultPrevented).toBe(false);
    expect(forwarded).toEqual([]);
  });

  test('after unmount the canvas is left alone', () => {
    configureUI({ memoryRouter: { initialPath: '/pages', onNavigate: () => {}, subscribe: () => () => {} } });
    const { unmount } = renderHook(() => useCanvasSaveShortcut(doc));
    unmount();

    expect(pressSave().defaultPrevented).toBe(false);
    expect(forwarded).toEqual([]);
  });
});
