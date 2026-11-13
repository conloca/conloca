/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { configureUI } from '../../ui-config.js';
import { LIVE_PAGE_SETTINGS_HINT, PageEditorHeaderActions } from './PageEditorHeaderActions.js';

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

  test('a live page, given no save props, has no Save button', () => {
    configureUI({ hosted: true });
    const { saveState: _state, isDirty: _dirty, onSave: _save, ...live } = baseProps;
    render(<PageEditorHeaderActions {...live} />);
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
  });

  test('a live page shows Page settings as unavailable, says why, and does not open them', () => {
    let opened = 0;
    render(
      <PageEditorHeaderActions
        {...baseProps}
        onOpenMetadata={() => {
          opened += 1;
        }}
        pageSettingsDisabledReason={LIVE_PAGE_SETTINGS_HINT}
      />,
    );
    const settings = screen.getByRole('button', { name: `Page settings unavailable. ${LIVE_PAGE_SETTINGS_HINT}` });
    expect(settings.getAttribute('aria-disabled')).toBe('true');
    expect(settings.getAttribute('title')).toBe(LIVE_PAGE_SETTINGS_HINT);
    settings.click();
    expect(opened).toBe(0);
    expect(LIVE_PAGE_SETTINGS_HINT).toBe('Page settings are not available yet while changes save as you type.');
  });
});
