/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { z } from 'zod';
import { PageMetadataDialog } from '../src/components/dialogs/PageMetadataDialog.js';
import { definePageSchema } from '../src/page-schema-define.js';
import { setPageSchemas } from '../src/page-schemas.js';
import type { PageMetadata } from '../src/types.js';

const savedPage: PageMetadata = {
  title: 'Saved article',
  pathname: '/article',
  description: '',
  customMeta: {},
  publishDate: null,
  unpublishDate: null,
  collection: 'pages',
  type: 'puck',
};
beforeEach(() => {
  setPageSchemas({});
});
afterEach(() => {
  cleanup();
  setPageSchemas({});
});

function Editor({
  onSave,
  page = savedPage,
}: {
  onSave: (metadata: PageMetadata) => Promise<void>;
  page?: PageMetadata;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Page settings
      </button>
      <PageMetadataDialog open={open} onOpenChange={setOpen} page={page} onSave={onSave} />
    </>
  );
}
async function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: 'Page settings' }));
  return screen.findByRole('dialog');
}
function titleField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: /^Title/ }) as HTMLInputElement;
}
function form(): HTMLFormElement {
  const element = screen.getByRole('dialog').querySelector('form');
  if (!element) throw new Error('Settings form is missing');
  return element;
}

describe('page settings save belongs to the form that submitted it', () => {
  test('a completed old save cannot close a reopened dialog or discard its new draft', async () => {
    const request = Promise.withResolvers<void>();
    const save = mock(() => request.promise);
    render(<Editor onSave={save} />);
    await openSettings();
    fireEvent.change(titleField(), { target: { value: 'First draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await openSettings();
    fireEvent.change(titleField(), { target: { value: 'New unsaved draft' } });
    await act(async () => {
      request.resolve();
      await request.promise;
    });
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(titleField().value).toBe('New unsaved draft');
    expect(save).toHaveBeenCalledTimes(1);
  });
  test('two form submissions while one write is pending start only one write', async () => {
    const request = Promise.withResolvers<void>();
    const save = mock(() => request.promise);
    render(<Editor onSave={save} />);
    await openSettings();
    const settings = form();
    act(() => {
      fireEvent.submit(settings);
      fireEvent.submit(settings);
    });
    const calls = save.mock.calls.length;
    await act(async () => {
      request.resolve();
      await request.promise;
    });
    expect(calls).toBe(1);
  });
});

for (const mode of ['full', 'minimal', 'none'] as const) {
  test(`direct form submission cannot save an emptied title in ${mode} mode`, async () => {
    if (mode !== 'full')
      setPageSchemas({
        '/': definePageSchema({
          schema: z.object({ title: z.string() }),
          coreFields: { mode },
        }),
      });
    const save = mock(async () => {});
    render(<Editor onSave={save} page={{ ...savedPage, customMeta: { title: savedPage.title } }} />);
    await openSettings();
    fireEvent.change(titleField(), { target: { value: '' } });
    await act(async () => {
      fireEvent.submit(form());
    });
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });
}

for (const editedField of ['title', 'author'] as const) {
  test(`a pending save does not discard a newer ${editedField} edit`, async () => {
    setPageSchemas({ '/': definePageSchema({ schema: z.object({ author: z.string().optional() }) }) });
    const request = Promise.withResolvers<void>();
    const save = mock(() => request.promise);
    render(<Editor onSave={save} page={{ ...savedPage, customMeta: { author: 'Ada' } }} />);
    await openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const field = screen.getByRole('textbox', { name: editedField === 'title' ? /^Title/ : /^Author/ });
    fireEvent.change(field, { target: { value: 'New unsaved value' } });
    await act(async () => {
      request.resolve();
      await request.promise;
    });
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(
      (screen.getByRole('textbox', { name: editedField === 'title' ? /^Title/ : /^Author/ }) as HTMLInputElement).value,
    ).toBe('New unsaved value');
    expect(save).toHaveBeenCalledTimes(1);
  });
}
