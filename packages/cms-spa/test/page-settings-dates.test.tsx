/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { PageMetadataDialog } from '../src/components/dialogs/PageMetadataDialog.js';
import { setPageSchemas } from '../src/page-schemas.js';
import type { PageMetadata } from '../src/types.js';
import { buildMetadataUpdate, extractPageMetadata } from '../src/utils/pageMetadata.js';

/** A page whose schedule was written by hand: a date, and a date-time with an offset and seconds. */
const page = extractPageMetadata(
  {
    collection: 'pages',
    type: 'mdx',
    localized: {
      meta: { title: 'Notes' },
      pathname: '/notes',
      publishAt: '2024-01-01',
      unpublishAt: '2030-06-30T12:00:30+02:00',
    },
  },
  null,
);

beforeEach(() => setPageSchemas({}));
afterEach(() => {
  cleanup();
  setPageSchemas({});
});

function Editor({ onSave }: { onSave: (metadata: PageMetadata) => Promise<void> }) {
  const [open, setOpen] = useState(true);
  return <PageMetadataDialog open={open} onOpenChange={setOpen} page={page} onSave={onSave} />;
}

/** The update a page-settings save sends after `edit` runs on the open dialog. */
async function savedUpdate(edit: () => void) {
  const save = mock(async (_metadata: PageMetadata) => {});
  render(<Editor onSave={save} />);
  await screen.findByRole('dialog');
  edit();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const metadata = save.mock.calls[0]?.[0];
  if (metadata === undefined) throw new Error('no save');
  return buildMetadataUpdate(metadata);
}

describe('page settings save and the schedule dates', () => {
  test('a save that leaves the dates alone sends them back as they were written', async () => {
    const update = await savedUpdate(() =>
      fireEvent.change(screen.getByRole('textbox', { name: /^Title/ }), { target: { value: 'Renamed' } }),
    );
    expect(update.publishAt).toBe('2024-01-01');
    expect(update.unpublishAt).toBe('2030-06-30T12:00:30+02:00');
  });

  test('a changed date is sent as the new instant', async () => {
    const update = await savedUpdate(() =>
      fireEvent.change(screen.getByLabelText(/^Publish/), { target: { value: '2024-02-03T04:05' } }),
    );
    expect(update.publishAt).toBe(new Date('2024-02-03T04:05').toISOString());
    expect(update.unpublishAt).toBe('2030-06-30T12:00:30+02:00');
  });
});
