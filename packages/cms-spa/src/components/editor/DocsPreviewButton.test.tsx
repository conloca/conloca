/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { configureUI } from '../../ui-config.js';
import { Toaster } from '../toast.js';
import { DocsPreviewButton } from './DocsPreviewButton.js';
import { DOCS_PREVIEW_UNAVAILABLE } from './preview-availability.js';

afterEach(() => {
  cleanup();
  configureUI({});
  // Sonner appends its section to document.body; clear it so one test's toast can't satisfy the next.
  document.body.innerHTML = '';
});

describe('DocsPreviewButton', () => {
  test('shows in the workspace editor, saying why it does nothing yet', () => {
    configureUI({ openPreview: async () => ({ ok: true, url: 'https://site.test/' }) });
    render(<DocsPreviewButton />);
    const button = screen.getByRole('button', { name: /Preview/ });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('title')).toBe("Full-page preview isn't available for docs pages yet");
  });

  test('explains itself in a toast when clicked', async () => {
    configureUI({ openPreview: async () => ({ ok: true, url: 'https://site.test/' }) });
    render(
      <>
        <Toaster />
        <DocsPreviewButton />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }));
    expect(await screen.findByText(DOCS_PREVIEW_UNAVAILABLE)).toBeTruthy();
  });

  test('is absent where there is no draft preview (the local editor)', () => {
    configureUI({});
    render(<DocsPreviewButton />);
    expect(screen.queryByRole('button', { name: /Preview/ })).toBeNull();
  });
});
