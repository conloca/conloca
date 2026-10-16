/// <reference lib="dom" />
/**
 * Page settings closed without saving. The page editors keep the dialog
 * mounted and only toggle it open, so an edit abandoned by closing it must not
 * come back on the next open as if it were the page's current setting.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { PageMetadataDialog } from '../src/components/dialogs/PageMetadataDialog.js';
import { definePageSchema } from '../src/page-schema-define.js';
import { setPageSchemas } from '../src/page-schemas.js';
import type { PageMetadata } from '../src/types.js';
import { authorFields } from './fixtures/typia/host-schemas.js';

const page: PageMetadata = {
  title: 'Saved title',
  description: '',
  pathname: '/blog/probe',
  publishDate: null,
  unpublishDate: null,
  customMeta: { author: 'Ada' },
  collection: 'pages',
  type: 'puck',
};

const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  setPageSchemas({
    '/blog/': definePageSchema({
      label: 'Blog post',
      schema: authorFields,
      ui: { author: { control: 'text', group: 'post' } },
      groups: [{ id: 'post', label: 'Blog post' }],
    }),
  });
  // Opening at a field scrolls it into view, which the test DOM does not implement.
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScrollIntoView;
  setPageSchemas({});
});

/** Hosts the dialog the way the page editors do: always mounted, opened from a button, closed through onOpenChange. */
function Editor({ focusField }: { focusField?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Page settings
      </button>
      <PageMetadataDialog open={open} onOpenChange={setOpen} page={page} focusField={focusField} />
    </>
  );
}

/** The control a label with this text names. */
function field(text: string): HTMLInputElement {
  const label = Array.from(document.body.querySelectorAll('label')).find(
    (candidate) => candidate.textContent?.replace('*', '').trim() === text,
  );
  const control = label?.control;
  if (!(control instanceof HTMLInputElement)) throw new Error(`no input is labelled "${text}"`);
  return control;
}

async function openSettings(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Page settings' }));
  await screen.findByRole('dialog');
  // The dialog starts listening for clicks outside it a tick after it opens.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Each way the dialog closes without saving: a close control (Cancel; the X is another), Escape, a click outside it. */
const closeWithoutSaving: [string, () => void][] = [
  ['Cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
  ['Escape', () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })],
  [
    'a click on the backdrop',
    () => {
      const backdrop = screen.getByRole('dialog').previousElementSibling;
      if (!backdrop) throw new Error('the dialog has no backdrop');
      // The dialog closes on the click that completes a press outside it, not on the press alone.
      fireEvent.pointerDown(backdrop);
      fireEvent.click(backdrop);
    },
  ],
];

describe('Page settings closed without saving', () => {
  test.each(closeWithoutSaving)('closed with %s, it reopens showing the saved settings', async (_, close) => {
    render(<Editor />);

    await openSettings();
    fireEvent.change(field('Title'), { target: { value: 'Half-typed tit' } });
    fireEvent.change(field('Author'), { target: { value: 'Someone else' } });
    close();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await openSettings();
    expect(field('Title').value).toBe('Saved title');
    expect(field('Author').value).toBe('Ada');
  });

  test('reopened at a field, it opens there and shows the saved settings', async () => {
    render(<Editor focusField="author" />);

    await openSettings();
    fireEvent.change(field('Author'), { target: { value: 'Someone else' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await openSettings();
    // Compared as a boolean: a failed match between two elements prints the whole document.
    await waitFor(() => expect(document.activeElement === field('Author')).toBe(true));
    expect(field('Author').value).toBe('Ada');
  });
});
