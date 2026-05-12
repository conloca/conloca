import { describe, expect, test } from 'bun:test';
import * as mdxPackage from '../index';
import { MDXEditor } from '../index';

describe('MDXEditor exports', () => {
  test('exports MDXEditor component', () => {
    expect(MDXEditor).toBeDefined();
    expect(typeof MDXEditor).toBe('object'); // ForwardRef is an object
  });

  test('MDXEditor has correct display name', () => {
    expect(MDXEditor.displayName).toBe('MDXEditor');
  });

  // Migration: the modal-based editor was removed when the SPA standardized
  // on the page-route editor (/blocks/:id, /pages/:id). These exports must
  // stay deleted; if they ever come back, callers should consider whether
  // the page editor handles their use case first.
  test('does NOT export the removed modal API', () => {
    expect((mdxPackage as any).MDXEditorModal).toBeUndefined();
    expect((mdxPackage as any).BaseMDXEditorModal).toBeUndefined();
  });
});
