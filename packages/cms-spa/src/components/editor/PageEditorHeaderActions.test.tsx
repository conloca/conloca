/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { configureUI } from '../../ui-config.js';
import { PageEditorHeaderActions } from './PageEditorHeaderActions.js';

afterEach(() => {
  cleanup();
  configureUI({});
});

const baseProps = {
  onPreview: () => {},
  currentLocale: 'en',
  availableLocales: ['en'],
  saveState: 'idle' as const,
  isDirty: true,
  onSave: () => {},
  onOpenMetadata: () => {},
  onBack: () => {},
};

describe('PageEditorHeaderActions hideEditorSave', () => {
  test('shows Save by default (standalone)', () => {
    configureUI({});
    render(<PageEditorHeaderActions {...baseProps} />);
    expect(screen.getByRole('button', { name: /save/i })).toBeTruthy();
  });

  test('hides Save when hideEditorSave is true', () => {
    configureUI({ hideEditorSave: true });
    render(<PageEditorHeaderActions {...baseProps} />);
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    // Preview remains so the header is not empty.
    expect(screen.getByTestId('preview-button')).toBeTruthy();
  });

  test('`hosted` alone keeps Save visible (host chrome complements it)', () => {
    configureUI({ hosted: true });
    render(<PageEditorHeaderActions {...baseProps} />);
    expect(screen.getByRole('button', { name: /save/i })).toBeTruthy();
  });
});
