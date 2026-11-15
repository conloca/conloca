/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { PageMetadataDialog } from '../src/components/dialogs/PageMetadataDialog.js';
import { definePageSchema } from '../src/page-schema-define.js';
import { setPageSchemas } from '../src/page-schemas.js';
import type { PageMetadata } from '../src/types.js';
import { ApplyClashError } from '../src/utils/apply-clash.js';
import { toDatetimeLocalValue } from '../src/utils/pageMetadata.js';
import { authorFields, titleFields } from './fixtures/typia/host-schemas.js';

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
          schema: titleFields,
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
    setPageSchemas({ '/': definePageSchema({ schema: authorFields }) });
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

/** A save refused for a clash on `anchor`, whose stored value is now `theirs`. */
const clash = (anchor: string, theirs: string) => async () => {
  throw new ApplyClashError([{ anchor, base: 'base', ours: 'ours', theirs }], 'Maria');
};

describe('a same-field clash reloads the field the form shows', () => {
  test('the title of a minimal-mode page, which the site schema holds', async () => {
    setPageSchemas({ '/': definePageSchema({ schema: titleFields, coreFields: { mode: 'minimal' } }) });
    render(
      <Editor
        onSave={clash('meta.title', 'Pricing for teams')}
        page={{ ...savedPage, customMeta: { title: 'Saved article' } }}
      />,
    );
    await openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Title changed while you were editing (last edited by Maria). Check it and apply again.',
    );
    expect(titleField().value).toBe('Pricing for teams');
  });

  test('a hinted nested field, named by its hint label', async () => {
    setPageSchemas({
      '/': definePageSchema({
        schema: authorFields,
        ui: { 'seo.robots': { control: 'text', label: 'Search robots' } },
      }),
    });
    render(
      <Editor
        onSave={clash('meta.seo.robots', 'noindex')}
        page={{ ...savedPage, customMeta: { seo: { robots: 'index' } } }}
      />,
    );
    await openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Search robots changed while you were editing (last edited by Maria). Check it and apply again.',
    );
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /^Search robots/ }).value).toBe('noindex');
  });

  test('a publish date, in the local time the field edits', async () => {
    const theirs = '2027-01-02T03:04:00.000Z';
    render(<Editor onSave={clash('publishAt', theirs)} />);
    await openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText<HTMLInputElement>(/^Publish/).value).toBe(toDatetimeLocalValue(new Date(theirs)));
  });
});
