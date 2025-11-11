import { describe, expect, test } from 'bun:test';
import { MDXEditor, MDXEditorModal } from '../index';

describe('MDXEditor exports', () => {
  test('exports MDXEditor component', () => {
    expect(MDXEditor).toBeDefined();
    expect(typeof MDXEditor).toBe('object'); // ForwardRef is an object
  });

  test('exports MDXEditorModal component', () => {
    expect(MDXEditorModal).toBeDefined();
    expect(typeof MDXEditorModal).toBe('function');
  });

  test('MDXEditor has correct display name', () => {
    expect(MDXEditor.displayName).toBe('MDXEditor');
  });
});
