import {
  ContentAPIClient,
  getContentAPIClient,
  type LocalizedEntry,
  setContentAPIClient,
} from '@conloca/content-api-client';
import { BaseMDXEditor } from '@conloca/mdx';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { EDITOR_DIRTY_CHANGED_EVENT, flushOpenEditor, isOpenEditorDirty } from '../../editor-flush.js';
import { ThemeProvider } from '../../hooks/useTheme.js';
import { configureUI, getUIConfig } from '../../ui-config.js';
import type { CMSMDXEditorProps } from './CMSMDXEditor.js';
import { FragmentEditor } from './FragmentEditor.js';

/**
 * The fragment editor as its route mounts it: loading and saving a fragment through the content API, with a plain
 * textarea standing in for the MDX surface (the stories are about the header and exit actions, not about typing).
 *
 * Save edits persists changes without navigating; Back requests navigation through the real unsaved-changes dialog.
 */

type UpdateInput = Parameters<ContentAPIClient['updateLocalized']>[0];

const FRAGMENT: LocalizedEntry = {
  id: 'shared-footer',
  type: 'mdx',
  kind: 'fragment',
  site: 'default',
  collection: 'fragments',
  localized: {
    locale: 'en',
    etag: 'v1',
    created: '2026-10-28T00:00:00.000Z',
    modified: '2026-10-28T00:00:00.000Z',
    meta: { title: 'Shared footer' },
    content: { mdx: '# Shared footer' },
  },
};

/** The MDX a save carries; the stories only ever save MDX. */
function savedMdx({ data }: UpdateInput): string {
  const { content } = data;
  if (content && typeof content === 'object' && 'mdx' in content && typeof content.mdx === 'string') {
    return content.mdx;
  }
  throw new Error('The save carried no MDX.');
}

/** The stored fragment; every save that reaches it is recorded. */
class FragmentContentAPI extends ContentAPIClient {
  entries = new Map<string, LocalizedEntry>([[`${FRAGMENT.id}/en`, FRAGMENT]]);
  saves: string[] = [];
  requests: UpdateInput[] = [];

  override async getContent(id: string) {
    const entries = [...this.entries.values()].filter((entry) => entry.id === id);
    const first = entries[0];
    if (!first) return null;
    return {
      id: first.id,
      type: first.type,
      kind: first.kind,
      site: first.site,
      collection: first.collection,
      locales: Object.fromEntries(entries.map((entry) => [entry.localized.locale, entry.localized])),
    };
  }

  override async getLocalized(id: string, locale: string) {
    return this.entries.get(`${id}/${locale}`) ?? null;
  }

  recordSave(input: UpdateInput) {
    this.requests.push(structuredClone(input));
    this.saves.push(savedMdx(input));
  }

  override async getFragments() {
    return { items: [], total: 0 };
  }

  override async getSitesConfig() {
    return { sites: { default: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] };
  }

  override async updateLocalized(input: UpdateInput): ReturnType<ContentAPIClient['updateLocalized']> {
    this.recordSave(input);
    return this.completeSave(input);
  }

  protected async completeSave(input: UpdateInput): ReturnType<ContentAPIClient['updateLocalized']> {
    const entry = await this.getLocalized(input.id, input.locale);
    if (!entry) return { success: false, reason: 'not_found' };
    const { localized } = entry;
    if (input.etag !== localized.etag) {
      return { success: false, reason: 'stale_write', currentEtag: localized.etag };
    }
    const etag = `${localized.etag}-saved`;
    this.entries.set(`${input.id}/${input.locale}`, {
      ...entry,
      localized: { ...localized, etag, content: { mdx: savedMdx(input) } },
    });
    return { success: true, etag };
  }
}

/** The backend refuses the write outright. */
class FailingContentAPI extends FragmentContentAPI {
  override async updateLocalized(input: UpdateInput): Promise<never> {
    this.recordSave(input);
    throw new Error('The content service did not answer.');
  }
}

/** Both locales exist, and the backend refuses writes in either one. */
class TranslatedFailingContentAPI extends FailingContentAPI {
  override async getSitesConfig() {
    return { sites: { default: { locales: ['en', 'nl'], defaultLocale: 'en' } }, globalLocales: ['en', 'nl'] };
  }

  override async getContent(id: string) {
    const entry = await super.getContent(id);
    return entry
      ? {
          ...entry,
          locales: { ...entry.locales, nl: { ...FRAGMENT.localized, locale: 'nl', content: { mdx: '# Voettekst' } } },
        }
      : null;
  }

  override async getLocalized(id: string, locale: string) {
    return locale === 'nl' && id === FRAGMENT.id
      ? { ...FRAGMENT, localized: { ...FRAGMENT.localized, locale, content: { mdx: '# Voettekst' } } }
      : super.getLocalized(id, locale);
  }
}

/** A write that stays in flight until the story releases it. */
class DelayedContentAPI extends FragmentContentAPI {
  private releases: (() => void)[] = [];

  get release(): (() => void) | undefined {
    return this.releases[0];
  }

  override async getSitesConfig() {
    return { sites: { default: { locales: ['en', 'nl'], defaultLocale: 'en' } }, globalLocales: ['en', 'nl'] };
  }

  constructor() {
    super();
    this.entries.set('shared-header/en', {
      ...FRAGMENT,
      id: 'shared-header',
      localized: { ...FRAGMENT.localized, etag: 'header-v1', content: { mdx: '# Shared header' } },
    });
    this.entries.set(`${FRAGMENT.id}/nl`, {
      ...FRAGMENT,
      localized: { ...FRAGMENT.localized, locale: 'nl', etag: 'nl-v1', content: { mdx: '# Voettekst' } },
    });
  }

  override async updateLocalized(input: UpdateInput) {
    this.recordSave(input);
    await new Promise<void>((resolve) => {
      this.releases.push(resolve);
    });
    return this.completeSave(input);
  }

  finish() {
    const release = this.releases.shift();
    if (!release) throw new Error('The story has no pending save.');
    release();
  }
}

/** Someone else saved the fragment after it was opened. */
class StaleContentAPI extends FragmentContentAPI {
  override async updateLocalized(input: UpdateInput) {
    this.recordSave(input);
    return {
      success: false,
      reason: 'stale_write' as const,
      currentEtag: 'theirs',
      conflictDetails: { metaChanged: false, contentChanged: true },
    };
  }
}

/** The content API of the story on screen, installed by its `beforeEach`. */
let api = new FragmentContentAPI();

function installStoryApi(next: FragmentContentAPI, ui: { hosted: boolean }) {
  const previousApi = getContentAPIClient();
  const previousUi = getUIConfig();
  api = next;
  setContentAPIClient(api);
  configureUI({ ...previousUi, hosted: ui.hosted, hideEditorSave: false });
  return () => {
    setContentAPIClient(previousApi);
    configureUI(previousUi);
  };
}

function TextareaFragmentSurface({ value, onChange }: CMSMDXEditorProps) {
  return (
    <textarea
      aria-label="Fragment markdown"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      className="w-full h-64 p-2 bg-panel text-foreground"
    />
  );
}

/** Where the editor's exits lead, so a click on Back shows on screen. */
function FragmentEditorRoute({ entry, keyboard = false }: { entry: string; keyboard?: boolean }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }),
  );
  // The unsaved-changes guard needs a data router.
  const [router] = useState(() =>
    createMemoryRouter(
      [
        {
          path: '/fragments/:id',
          element: <FragmentEditor EditorComponent={keyboard ? BaseMDXEditor : TextareaFragmentSurface} />,
        },
        { path: '/pages/:pageId', element: <p data-testid="dest-page">The page editor</p> },
        { path: '/fragments', element: <p data-testid="dest-fragments">The fragments list</p> },
      ],
      {
        initialEntries: [entry],
      },
    ),
  );
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <div style={{ height: '480px' }}>
          <RouterProvider router={router} />
        </div>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

const FROM_PAGE = `/fragments/${FRAGMENT.id}?from=page&pageId=home`;
const FROM_LIST = `/fragments/${FRAGMENT.id}`;

/** A containing host can replace its mounted editor independently of an in-editor navigation request. */
function ReplacingFragmentHost() {
  const [entry, setEntry] = useState(FROM_PAGE);
  return (
    <>
      <button type="button" onClick={() => setEntry('/fragments/shared-header')}>
        Replace host editor
      </button>
      <FragmentEditorRoute key={entry} entry={entry} />
    </>
  );
}

const meta = {
  title: 'Editor/FragmentEditor',
  component: FragmentEditor,
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function openEditor(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const surface = await canvas.findByRole('textbox', { name: 'Fragment markdown' }, { timeout: 10_000 });
  return { canvas, surface };
}

const status = (canvas: { getByTestId(id: string): HTMLElement }) => canvas.getByTestId('fragment-editor-status');

/**
 * With external publication, opened from a page. A fresh fragment has nothing to save; typing arms Save edits, saving keeps the draft and
 * the status line reports local save success; the button settles to Saved and cannot re-send the same text.
 */
export const EmbeddedFromPageSaveEdits: Story = {
  beforeEach: () => installStoryApi(new FragmentContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: async ({ canvasElement }) => {
    const { canvas, surface } = await openEditor(canvasElement);
    await expect(status(canvas)).toHaveTextContent('No unsaved changes.');
    await expect(canvas.getByRole('button', { name: 'Save edits' })).toBeDisabled();
    await expect(canvas.getByTestId('shared-fragment-banner')).toHaveTextContent(
      'This is a shared fragment. Saving updates every page that uses it.',
    );
    // The arrow is the single exit; saving does not navigate.
    await expect(canvas.queryByRole('button', { name: /^(Done|Cancel)$/ })).toBeNull();

    await userEvent.type(surface, ' with a new link');
    await expect(status(canvas)).toHaveTextContent('Unsaved changes.');
    await userEvent.click(canvas.getByRole('button', { name: 'Save edits' }));

    await waitFor(() => expect(api.saves).toEqual(['# Shared footer with a new link']));
    await expect(api.requests).toEqual([
      { id: FRAGMENT.id, locale: 'en', etag: 'v1', data: { content: { mdx: '# Shared footer with a new link' } } },
    ]);
    const saved = await canvas.findByRole('button', { name: 'Saved' });
    await expect(saved).toBeDisabled();
    await expect(status(canvas)).toHaveTextContent('All changes saved.');

    // Saved is a dead end for Save: nothing was re-sent...
    await userEvent.click(saved);
    await expect(api.saves).toHaveLength(1);
    // The saved state describes publishing separately from the draft.
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Save edits' })).toBeDisabled(), { timeout: 4000 });
    await expect(status(canvas)).toHaveTextContent('All changes saved.');
  },
};

/** Back with nothing unsaved returns to the page at once, and neither saves nor asks anything. */
export const BackWithNothingUnsavedReturnsToThePage: Story = {
  beforeEach: () => installStoryApi(new FragmentContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: async ({ canvasElement }) => {
    const { canvas } = await openEditor(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /^Back to/ }));
    await expect(await canvas.findByTestId('dest-page')).toBeVisible();
    await expect(canvas.queryByRole('heading', { name: 'Discard changes?' })).toBeNull();
    await expect(api.saves).toHaveLength(0);
  },
};

/** Back with unsaved edits asks first; Continue editing keeps the author and draft in place. */
export const BackWithUnsavedEditsAsksFirst: Story = {
  beforeEach: () => installStoryApi(new FragmentContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: async ({ canvasElement }) => {
    const { canvas, surface } = await openEditor(canvasElement);
    await userEvent.type(surface, ' edited');
    await userEvent.click(canvas.getByRole('button', { name: /^Back to/ }));

    await expect(await canvas.findByRole('heading', { name: 'Discard changes?' })).toBeVisible();
    await expect(canvas.queryByTestId('dest-page')).toBeNull();
    await expect(api.saves).toHaveLength(0);

    await userEvent.click(canvas.getByRole('button', { name: 'Continue editing' }));
    await waitFor(() => expect(canvas.queryByRole('heading', { name: 'Discard changes?' })).toBeNull());
    await expect(canvas.getByRole('textbox', { name: 'Fragment markdown' })).toHaveValue('# Shared footer edited');
  },
};

/** Discard changes leaves for the originating page and writes nothing. */
export const BackThenDiscardLeavesWithoutSaving: Story = {
  beforeEach: () => installStoryApi(new FragmentContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: async ({ canvasElement }) => {
    const { canvas, surface } = await openEditor(canvasElement);
    await userEvent.type(surface, ' edited');
    await userEvent.click(canvas.getByRole('button', { name: /^Back to/ }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Discard changes' }));
    await expect(await canvas.findByTestId('dest-page')).toBeVisible();
    await expect(api.saves).toHaveLength(0);
  },
};

/** Save and go back persists the draft before returning to the page, without publishing. */
export const BackThenSaveAndGoBackSavesThenLeaves: Story = {
  beforeEach: () => installStoryApi(new FragmentContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: async ({ canvasElement }) => {
    const { canvas, surface } = await openEditor(canvasElement);
    await userEvent.type(surface, ' edited');
    await userEvent.click(canvas.getByRole('button', { name: /^Back to/ }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Save and go back' }));
    await expect(await canvas.findByTestId('dest-page')).toBeVisible();
    await expect(api.saves).toEqual(['# Shared footer edited']);
  },
};

/** Opened from the fragments list (not from a page), Back is there too and returns to the list. */
export const EmbeddedFromTheFragmentsList: Story = {
  beforeEach: () => installStoryApi(new FragmentContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_LIST} />,
  play: async ({ canvasElement }) => {
    const { canvas } = await openEditor(canvasElement);
    await expect(canvas.queryByTestId('shared-fragment-banner')).toBeNull();
    await expect(canvas.queryByRole('button', { name: /^(Done|Cancel)$/ })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: /^Back to/ }));
    await expect(await canvas.findByTestId('dest-fragments')).toBeVisible();
  },
};

/** Standalone Save edits persists the fragment without mentioning a separate Publish step. */
export const StandaloneSaveEditsHasNoPublishStep: Story = {
  beforeEach: () => installStoryApi(new FragmentContentAPI(), { hosted: false }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: async ({ canvasElement }) => {
    const { canvas, surface } = await openEditor(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Save edits' })).toBeDisabled();
    await userEvent.type(surface, ' edited');
    await expect(status(canvas)).toHaveTextContent('Unsaved changes.');
    await userEvent.click(canvas.getByRole('button', { name: 'Save edits' }));
    await waitFor(() => expect(api.saves).toEqual(['# Shared footer edited']));
    await expect(await canvas.findByRole('button', { name: 'Saved' })).toBeDisabled();
    await expect(status(canvas)).toHaveTextContent('All changes saved.');
    await expect(canvas.getByTestId('shared-fragment-banner')).toHaveTextContent(
      'This is a shared fragment. Saving updates every page that uses it.',
    );
    await expect(canvasElement).not.toHaveTextContent('Publish');
  },
};

/** A save the backend rejects keeps the edits, says so, and Retry save sends the same text again. */
export const SaveFailureOffersRetry: Story = {
  beforeEach: () => installStoryApi(new FailingContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: async ({ canvasElement }) => {
    const { canvas, surface } = await openEditor(canvasElement);
    await userEvent.type(surface, ' edited');
    await userEvent.click(canvas.getByRole('button', { name: 'Save edits' }));

    await waitFor(() => expect(status(canvas)).toHaveTextContent('Save failed. Your changes are still here.'));
    await userEvent.click(within(canvasElement.ownerDocument.body).getByRole('button', { name: 'Dismiss' }));
    const retry = canvas.getByRole('button', { name: 'Retry save' });
    await expect(retry).toBeEnabled();
    await expect(canvas.getByRole('textbox', { name: 'Fragment markdown', hidden: true })).toHaveValue(
      '# Shared footer edited',
    );
    await userEvent.click(retry);
    await waitFor(() => expect(api.saves).toHaveLength(2));
  },
};

/** A stale write says Conflict and that the changes are not saved; the conflict dialog takes over. */
export const StaleSaveIsAConflict: Story = {
  beforeEach: () => installStoryApi(new StaleContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: async ({ canvasElement }) => {
    const { canvas, surface } = await openEditor(canvasElement);
    await userEvent.type(surface, ' edited');
    await userEvent.click(canvas.getByRole('button', { name: 'Save edits' }));

    await expect(await canvas.findByRole('dialog', { name: 'Conflict Detected' })).toBeVisible();
    await expect(status(canvas)).toHaveTextContent('Someone else changed this fragment. Your changes are not saved.');
    await expect(canvas.getByRole('button', { name: 'Conflict', hidden: true })).toBeEnabled();
  },
};

/** Discarding failed English edits before switching locale clears their feedback. */
export const LocaleSwitchAfterFailedSave: Story = {
  beforeEach: () => installStoryApi(new TranslatedFailingContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: async ({ canvasElement }) => {
    const { canvas, surface } = await openEditor(canvasElement);
    const document = within(canvasElement.ownerDocument.body);
    await userEvent.type(surface, ' edited');
    await userEvent.click(canvas.getByRole('button', { name: 'Save edits' }));
    await userEvent.click(await document.findByRole('button', { name: 'Dismiss' }));
    await userEvent.click(canvas.getByRole('combobox', { name: 'Locale' }));
    await userEvent.click(await document.findByRole('option', { name: 'nl' }));
    await userEvent.click(await document.findByRole('button', { name: 'Discard Changes' }));
    const translatedSurface = await canvas.findByRole('textbox', { name: 'Fragment markdown' });
    await waitFor(() => expect(translatedSurface).toHaveValue('# Voettekst'));
    await expect(status(canvas)).toHaveTextContent('No unsaved changes.');
    await expect(canvas.getByRole('button', { name: 'Save edits' })).toBeDisabled();
    await userEvent.type(translatedSurface, ' bijgewerkt');
    await expect(canvas.getByRole('button', { name: 'Save edits' })).toBeEnabled();
    await expect(status(canvas)).toHaveTextContent('Unsaved changes.');
  },
};

/** New edits after a failed write was completely reverted have not failed to save. */
export const EditAfterRevertingFailedSave: Story = {
  beforeEach: () => installStoryApi(new FailingContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: async ({ canvasElement }) => {
    const { canvas, surface } = await openEditor(canvasElement);
    await userEvent.type(surface, ' failed');
    await userEvent.click(canvas.getByRole('button', { name: 'Save edits' }));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('button', { name: 'Dismiss' }));
    await userEvent.clear(surface);
    await userEvent.type(surface, '# Shared footer');
    await expect(status(canvas)).toHaveTextContent('No unsaved changes.');
    await userEvent.type(surface, ' new edit');
    await expect(canvas.getByRole('button', { name: 'Save edits' })).toBeEnabled();
    await expect(status(canvas)).toHaveTextContent('Unsaved changes.');
  },
};

/** The locale cannot change underneath the write whose status is on screen. */
export const LocaleWaitsForPendingSave: Story = {
  beforeEach: () => installStoryApi(new DelayedContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: async ({ canvasElement }) => {
    const { canvas, surface } = await openEditor(canvasElement);
    if (!(api instanceof DelayedContentAPI)) throw new Error('The story needs its delayed API.');
    await userEvent.type(surface, ' saved');
    await userEvent.click(canvas.getByRole('button', { name: 'Save edits' }));
    try {
      await expect(status(canvas)).toHaveTextContent('Saving');
      await expect(canvas.getByRole('combobox', { name: 'Locale' })).toBeDisabled();
      await expect(canvas.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    } finally {
      api.finish();
    }
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Saved' })).toBeVisible());
    await expect(canvas.getByRole('combobox', { name: 'Locale' })).toBeEnabled();
  },
};

/** A host save can start while the locale's unsaved-changes choice is open. */
export const LocaleDiscardWaitsForHostSave: Story = {
  beforeEach: () => installStoryApi(new DelayedContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: async ({ canvasElement }) => {
    const { canvas, surface } = await openEditor(canvasElement);
    if (!(api instanceof DelayedContentAPI)) throw new Error('The story needs its delayed API.');
    const delayed = api;
    const document = within(canvasElement.ownerDocument.body);
    await userEvent.type(surface, ' saved');
    await userEvent.click(canvas.getByRole('combobox', { name: 'Locale' }));
    await userEvent.click(await document.findByRole('option', { name: 'nl' }));
    const discard = await document.findByRole('button', { name: 'Discard Changes' });
    const flush = flushOpenEditor();
    try {
      await waitFor(() => expect(status(canvas)).toHaveTextContent('Saving'));
      await expect(discard).toBeDisabled();
      await expect(document.getByRole('button', { name: 'Save & Continue' })).toBeDisabled();
    } finally {
      delayed.finish();
      await flush;
    }
    await waitFor(() => expect(document.queryByRole('heading', { name: 'Unsaved Changes' })).toBeNull());
    await waitFor(() => expect(canvas.getByRole('combobox', { name: 'Locale' })).toHaveTextContent('nl'));
    await expect(api.saves).toEqual(['# Shared footer saved']);
    await expect(api.requests).toEqual([
      { id: FRAGMENT.id, locale: 'en', etag: 'v1', data: { content: { mdx: '# Shared footer saved' } } },
    ]);
    await expect((await api.getLocalized(FRAGMENT.id, 'en'))?.localized.content).toEqual({
      mdx: '# Shared footer saved',
    });
  },
};

/** Replacing the host editor leaves its outstanding write bound to the old fragment. */
export const LateSaveBelongsToItsFragment: Story = {
  beforeEach: () => installStoryApi(new DelayedContentAPI(), { hosted: true }),
  render: () => <ReplacingFragmentHost />,
  play: async ({ canvasElement }) => {
    const { canvas, surface } = await openEditor(canvasElement);
    if (!(api instanceof DelayedContentAPI)) throw new Error('The story needs its delayed API.');
    const delayed = api;
    await userEvent.type(surface, ' pending');
    const saving = flushOpenEditor();
    try {
      await waitFor(() => expect(status(canvas)).toHaveTextContent('Saving'));
      await userEvent.clear(surface);
      await userEvent.type(surface, '# Shared footer');
      await userEvent.click(canvas.getByRole('button', { name: 'Replace host editor' }));
      await waitFor(() =>
        expect(canvas.getByRole('textbox', { name: 'Fragment markdown' })).toHaveValue('# Shared header'),
      );
    } finally {
      delayed.finish();
      await saving;
    }
    await expect(await saving).toEqual({ ok: false, message: 'Could not save editor changes.' });
    await waitFor(() => expect(status(canvas)).toHaveTextContent('No unsaved changes.'));
    await expect(canvas.getByRole('button', { name: 'Save edits' })).toBeDisabled();
    await expect(api.requests).toEqual([
      { id: FRAGMENT.id, locale: 'en', etag: 'v1', data: { content: { mdx: '# Shared footer pending' } } },
    ]);
    await expect((await api.getLocalized('shared-header', 'en'))?.localized.etag).toBe('header-v1');
  },
};

/** Continue editing revokes the navigation intent even while its draft save is in flight. */
export const ContinueEditingDuringNavigationSave: Story = {
  beforeEach: () => installStoryApi(new DelayedContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: async ({ canvasElement }) => {
    const { canvas, surface } = await openEditor(canvasElement);
    if (!(api instanceof DelayedContentAPI)) throw new Error('The story needs its delayed API.');
    const delayed = api;
    await userEvent.type(surface, ' saved');
    await userEvent.click(canvas.getByRole('button', { name: /^Back to/ }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Save and go back' }));
    await waitFor(() => expect(status(canvas)).toHaveTextContent('Saving'));
    await userEvent.click(canvas.getByRole('button', { name: 'Continue editing' }));
    delayed.finish();
    await waitFor(() => expect(status(canvas)).toHaveTextContent('All changes saved.'));
    await expect(canvas.queryByTestId('dest-page')).toBeNull();
    await expect(canvas.queryByRole('heading', { name: 'Discard changes?' })).toBeNull();
    await expect(api.saves).toEqual(['# Shared footer saved']);
    await expect(api.requests).toEqual([
      { id: FRAGMENT.id, locale: 'en', etag: 'v1', data: { content: { mdx: '# Shared footer saved' } } },
    ]);
  },
};

/** Cancel also revokes a locale intent during either its own save or an independent host flush. */
async function cancelLocaleSave(canvasElement: HTMLElement, hostSave: boolean) {
  const { canvas, surface } = await openEditor(canvasElement);
  if (!(api instanceof DelayedContentAPI)) throw new Error('The story needs its delayed API.');
  const delayed = api;
  const document = within(canvasElement.ownerDocument.body);
  await userEvent.type(surface, ' saved');
  await userEvent.click(canvas.getByRole('combobox', { name: 'Locale' }));
  await document.findByRole('option', { name: 'nl' });
  await userEvent.keyboard('{ArrowDown}{Enter}');
  await document.findByRole('heading', { name: 'Unsaved Changes' });
  let flush: ReturnType<typeof flushOpenEditor> | undefined;
  if (hostSave) {
    flush = flushOpenEditor();
  } else {
    await userEvent.click(document.getByRole('button', { name: 'Save & Continue' }));
  }
  await waitFor(() => expect(status(canvas)).toHaveTextContent('Saving'));
  await expect(document.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  await userEvent.click(document.getByRole('button', { name: 'Cancel' }));
  delayed.finish();
  await flush;
  await waitFor(() => expect(status(canvas)).toHaveTextContent('All changes saved.'));
  await expect(canvas.getByRole('combobox', { name: 'Locale' })).toHaveTextContent('en');
  await expect(document.queryByRole('heading', { name: 'Unsaved Changes' })).toBeNull();
  await expect(api.saves).toEqual(['# Shared footer saved']);
  await expect(api.requests).toEqual([
    { id: FRAGMENT.id, locale: 'en', etag: 'v1', data: { content: { mdx: '# Shared footer saved' } } },
  ]);
}

export const CancelDuringLocaleSave: Story = {
  beforeEach: () => installStoryApi(new DelayedContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: ({ canvasElement }) => cancelLocaleSave(canvasElement, false),
};

export const CancelDuringHostSave: Story = {
  beforeEach: () => installStoryApi(new DelayedContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: ({ canvasElement }) => cancelLocaleSave(canvasElement, true),
};

/** A host flush completes an outstanding route intent once the draft is clean, with one write. */
export const NavigationWaitsForHostSave: Story = {
  beforeEach: () => installStoryApi(new DelayedContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: async ({ canvasElement }) => {
    const { canvas, surface } = await openEditor(canvasElement);
    if (!(api instanceof DelayedContentAPI)) throw new Error('The story needs its delayed API.');
    const delayed = api;
    await userEvent.type(surface, ' saved');
    await userEvent.click(canvas.getByRole('button', { name: /^Back to/ }));
    await canvas.findByRole('heading', { name: 'Discard changes?' });
    const flush = flushOpenEditor();
    await waitFor(() => expect(status(canvas)).toHaveTextContent('Saving'));
    delayed.finish();
    await flush;
    await expect(await canvas.findByTestId('dest-page')).toBeVisible();
    await expect(api.saves).toEqual(['# Shared footer saved']);
    await expect(api.requests).toEqual([
      { id: FRAGMENT.id, locale: 'en', etag: 'v1', data: { content: { mdx: '# Shared footer saved' } } },
    ]);
  },
};

/** A Dutch draft must use the Dutch destination and etag without changing English. */
export const TranslatedSaveUsesItsIdentity: Story = {
  beforeEach: () => installStoryApi(new DelayedContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: async ({ canvasElement }) => {
    const { canvas } = await openEditor(canvasElement);
    if (!(api instanceof DelayedContentAPI)) throw new Error('The story needs its delayed API.');
    const delayed = api;
    await userEvent.click(canvas.getByRole('combobox', { name: 'Locale' }));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('option', { name: 'nl' }));
    await waitFor(() => expect(canvas.getByRole('combobox', { name: 'Locale' })).toHaveTextContent('nl'));
    const surface = await canvas.findByRole('textbox', { name: 'Fragment markdown' });
    await waitFor(() => expect(surface).toHaveValue('# Voettekst'));
    await userEvent.type(surface, ' bijgewerkt');
    await userEvent.click(canvas.getByRole('button', { name: 'Save edits' }));
    await waitFor(() => expect(api.requests).toHaveLength(1));
    delayed.finish();
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Saved' })).toBeDisabled());
    await expect(api.requests).toEqual([
      { id: FRAGMENT.id, locale: 'nl', etag: 'nl-v1', data: { content: { mdx: '# Voettekst bijgewerkt' } } },
    ]);
    await expect((await api.getLocalized(FRAGMENT.id, 'en'))?.localized.content).toEqual({ mdx: '# Shared footer' });
    await expect((await api.getLocalized(FRAGMENT.id, 'nl'))?.localized.content).toEqual({
      mdx: '# Voettekst bijgewerkt',
    });
  },
};

/** A clean locale read stays pending while the author edits and requests another locale. */
class DelayedLocaleContentAPI extends DelayedContentAPI {
  localeReply = Promise.withResolvers<void>();
  localeRequested = false;
  localeReplyCompleted = false;

  override async getSitesConfig() {
    return {
      sites: { default: { locales: ['en', 'nl', 'de'], defaultLocale: 'en' } },
      globalLocales: ['en', 'nl', 'de'],
    };
  }

  override async getLocalized(id: string, locale: string) {
    if (locale === 'nl') {
      this.localeRequested = true;
      await this.localeReply.promise;
    }
    const entry = await super.getLocalized(id, locale);
    if (locale === 'nl') this.localeReplyCompleted = true;
    return entry;
  }
}

/** A stale Dutch load must leave the English draft and the newer German prompt intact. */
export const DelayedLocaleLoadPreservesNewPrompt: Story = {
  beforeEach: () => installStoryApi(new DelayedLocaleContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: async ({ canvasElement }) => {
    const { canvas, surface } = await openEditor(canvasElement);
    if (!(api instanceof DelayedLocaleContentAPI)) throw new Error('The story needs its delayed locale API.');
    const delayed = api;
    const body = within(canvasElement.ownerDocument.body);
    try {
      await userEvent.click(canvas.getByRole('combobox', { name: 'Locale' }));
      await userEvent.click(await body.findByRole('option', { name: 'nl' }));
      await waitFor(() => expect(delayed.localeRequested).toBe(true));
      await userEvent.type(surface, ' edited while Dutch loads');
      await userEvent.click(canvas.getByRole('combobox', { name: 'Locale' }));
      await userEvent.click(await body.findByRole('option', { name: 'de' }));
      await expect(await canvas.findByRole('heading', { name: 'Unsaved Changes' })).toBeVisible();
      delayed.localeReply.resolve();
      await waitFor(() => expect(delayed.localeReplyCompleted).toBe(true));
      await expect(surface).toHaveValue('# Shared footer edited while Dutch loads');
      await expect(canvas.getByRole('combobox', { name: 'Locale' })).toHaveTextContent('en');
      await expect(canvas.getByRole('heading', { name: 'Unsaved Changes' })).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Save & Continue' })).toBeEnabled();
      await expect(api.requests).toHaveLength(0);
    } finally {
      delayed.localeReply.resolve();
    }
  },
};

/** Host Publish must leave discarded English text off the branch while Dutch is still loading. */
export const LocaleDiscardPreventsHostWrite: Story = {
  beforeEach: () => installStoryApi(new DelayedLocaleContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: async ({ canvasElement }) => {
    const { canvas, surface } = await openEditor(canvasElement);
    if (!(api instanceof DelayedLocaleContentAPI)) throw new Error('The story needs its delayed locale API.');
    const delayed = api;
    try {
      await userEvent.type(surface, ' discarded draft');
      await userEvent.click(canvas.getByRole('combobox', { name: 'Locale' }));
      await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('option', { name: 'nl' }));
      await userEvent.click(await canvas.findByRole('button', { name: 'Discard Changes' }));
      await waitFor(() => expect(delayed.localeRequested).toBe(true));
      const pending = flushOpenEditor();
      if (delayed.release) delayed.finish();
      const result = await pending;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await expect(result).toEqual({ ok: true });
      await expect(api.requests).toHaveLength(0);
      await expect((await api.getLocalized(FRAGMENT.id, 'en'))?.localized.content).toEqual({ mdx: '# Shared footer' });
      delayed.localeReply.resolve();
      await waitFor(() => expect(canvas.getByRole('combobox', { name: 'Locale' })).toHaveTextContent('nl'));
      await expect(canvas.getByRole('textbox', { name: 'Fragment markdown' })).toHaveValue('# Voettekst');
    } finally {
      delayed.localeReply.resolve();
    }
  },
};

/** A host subscriber reads the real registration on every dirty-change event. */
function HostDirtyStatus() {
  const [dirty, setDirty] = useState(isOpenEditorDirty);
  useEffect(() => {
    const sync = () => setDirty(isOpenEditorDirty());
    window.addEventListener(EDITOR_DIRTY_CHANGED_EVENT, sync);
    sync();
    return () => window.removeEventListener(EDITOR_DIRTY_CHANGED_EVENT, sync);
  }, []);
  return <p data-testid="host-dirty">{dirty ? 'Host sees unsaved edits' : 'Host sees no unsaved edits'}</p>;
}

/** Cancelling a replacement locale restores the visible draft before any host flush. */
export const HostDirtyRestoredAfterRevokedLocale: Story = {
  beforeEach: () => installStoryApi(new DelayedLocaleContentAPI(), { hosted: true }),
  render: () => (
    <>
      <HostDirtyStatus />
      <FragmentEditorRoute entry={FROM_PAGE} />
    </>
  ),
  play: async ({ canvasElement }) => {
    const { canvas, surface } = await openEditor(canvasElement);
    if (!(api instanceof DelayedLocaleContentAPI)) throw new Error('The story needs its delayed locale API.');
    const delayed = api;
    const body = within(canvasElement.ownerDocument.body);
    try {
      await userEvent.type(surface, ' visible draft');
      await userEvent.click(canvas.getByRole('combobox', { name: 'Locale' }));
      await userEvent.click(await body.findByRole('option', { name: 'nl' }));
      await userEvent.click(await canvas.findByRole('button', { name: 'Discard Changes' }));
      await waitFor(() => expect(delayed.localeRequested).toBe(true));
      await expect(canvas.getByTestId('host-dirty')).toHaveTextContent('Host sees no unsaved edits');
      await userEvent.click(canvas.getByRole('combobox', { name: 'Locale' }));
      await userEvent.click(await body.findByRole('option', { name: 'de' }));
      await userEvent.click(await canvas.findByRole('button', { name: 'Cancel' }));
      await expect(canvas.getByTestId('host-dirty')).toHaveTextContent('Host sees unsaved edits');
      delayed.localeReply.resolve();
      await waitFor(() => expect(delayed.localeReplyCompleted).toBe(true));
      await expect(canvas.getByRole('combobox', { name: 'Locale' })).toHaveTextContent('en');
      await expect(surface).toHaveValue('# Shared footer visible draft');
      await expect(api.requests).toHaveLength(0);
      await expect((await api.getLocalized(FRAGMENT.id, 'en'))?.localized.content).toEqual({ mdx: '# Shared footer' });
    } finally {
      delayed.localeReply.resolve();
    }
  },
};

/** The locale read fails without issuing any save. */
class FailedLocaleContentAPI extends FragmentContentAPI {
  override async getSitesConfig() {
    return { sites: { default: { locales: ['en', 'nl'], defaultLocale: 'en' } }, globalLocales: ['en', 'nl'] };
  }
  override async getLocalized(id: string, locale: string) {
    if (locale === 'nl') throw new Error('Locale unavailable');
    return super.getLocalized(id, locale);
  }
}

export const CleanLocaleReadError: Story = {
  beforeEach: () => installStoryApi(new FailedLocaleContentAPI(), { hosted: true }),
  render: () => <FragmentEditorRoute entry={FROM_PAGE} />,
  play: async ({ canvasElement }) => {
    const { canvas } = await openEditor(canvasElement);
    await userEvent.click(canvas.getByRole('combobox', { name: 'Locale' }));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('option', { name: 'nl' }));
    await expect(await canvas.findByRole('heading', { name: 'Locale Switch Failed' })).toBeVisible();
    await expect(canvas.getByText('Failed to switch locale. Please try again.')).toBeVisible();
    await expect(canvas.queryByRole('heading', { name: 'Save Failed' })).not.toBeInTheDocument();
    await expect(api.requests).toHaveLength(0);
  },
};

export const DirtyLocaleReadError: Story = {
  beforeEach: () => installStoryApi(new FailedLocaleContentAPI(), { hosted: true }),
  render: () => (
    <>
      <HostDirtyStatus />
      <FragmentEditorRoute entry={FROM_PAGE} />
    </>
  ),
  play: async ({ canvasElement }) => {
    const { canvas, surface } = await openEditor(canvasElement);
    await userEvent.type(surface, ' recoverable draft');
    await userEvent.click(canvas.getByRole('combobox', { name: 'Locale' }));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('option', { name: 'nl' }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Discard Changes' }));
    await expect(await canvas.findByRole('heading', { name: 'Locale Switch Failed' })).toBeVisible();
    await expect(canvas.getByText('Failed to switch locale. Your changes are still here.')).toBeVisible();
    await expect(canvas.getByTestId('host-dirty')).toHaveTextContent('Host sees unsaved edits');
    await expect(api.requests).toHaveLength(0);
  },
};

/** Independent read/write gates reproduce explicit-save ownership without altering editor state. */
class ExplicitSaveContentAPI extends DelayedLocaleContentAPI {
  writeReply = Promise.withResolvers<void>();
  writeRequested = false;
  constructor(readonly outcome: 'conflict' | 'error' | 'success') {
    super();
  }
  override async updateLocalized(input: UpdateInput) {
    this.writeRequested = true;
    this.recordSave(input);
    await this.writeReply.promise;
    if (this.outcome === 'error') throw new Error('Explicit save unavailable');
    if (this.outcome === 'conflict') {
      return { success: false, reason: 'stale_write' as const, currentEtag: 'theirs' };
    }
    return this.completeSave(input);
  }
}

function explicitSaveRace(outcome: 'conflict' | 'error' | 'success', errorFirst = false, keyboard = false): Story {
  return {
    beforeEach: () =>
      installStoryApi(new ExplicitSaveContentAPI(outcome), keyboard ? { hosted: false } : { hosted: true }),
    render: () => (
      <>
        <HostDirtyStatus />
        <FragmentEditorRoute entry={FROM_PAGE} keyboard={keyboard} />
      </>
    ),
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      const body = within(canvasElement.ownerDocument.body);
      const surface = keyboard
        ? await waitFor(() => {
            const editable = canvasElement.querySelector<HTMLElement>('[contenteditable="true"]');
            if (!editable) throw new Error('Waiting for the production MDX keyboard surface');
            return editable;
          })
        : (await openEditor(canvasElement)).surface;
      if (!(api instanceof ExplicitSaveContentAPI)) throw new Error('Missing ordered read/write fixture');
      const delayed = api;
      try {
        await userEvent.click(surface);
        await userEvent.type(surface, ' explicitly saved draft');
        await userEvent.click(canvas.getByRole('combobox', { name: 'Locale' }));
        await userEvent.click(await body.findByRole('option', { name: 'nl' }));
        await userEvent.click(await canvas.findByRole('button', { name: 'Discard Changes' }));
        await waitFor(() => expect(delayed.localeRequested).toBe(true));
        await expect(canvas.getByTestId('host-dirty')).toHaveTextContent('Host sees no unsaved edits');
        if (keyboard) await userEvent.keyboard('{Control>}s{/Control}');
        else await userEvent.click(canvas.getByRole('button', { name: 'Save edits' }));
        await waitFor(() => expect(delayed.writeRequested).toBe(true));
        if (errorFirst) {
          delayed.writeReply.resolve();
          await expect(await canvas.findByRole('heading', { name: 'Save Failed' })).toBeVisible();
        }
        delayed.localeReply.resolve();
        await waitFor(() => expect(delayed.localeReplyCompleted).toBe(true));
        await expect(await canvas.findByRole('combobox', { name: 'Locale' })).toHaveTextContent('en');
        await expect(canvas.getByTestId('host-dirty')).toHaveTextContent('Host sees unsaved edits');
        if (!errorFirst) {
          await expect(status(canvas)).toHaveTextContent('Saving…');
          delayed.writeReply.resolve();
        }
        if (outcome === 'conflict')
          await expect(await canvas.findByRole('dialog', { name: 'Conflict Detected' })).toBeVisible();
        else if (outcome === 'error')
          await expect(await canvas.findByRole('heading', { name: 'Save Failed' })).toBeVisible();
        else await waitFor(() => expect(canvas.getByRole('button', { name: 'Saved' })).toBeDisabled());
        if (keyboard) await expect(surface).toHaveTextContent('explicitly saved draft');
        else await expect(surface).toHaveValue('# Shared footer explicitly saved draft');
        await expect((await delayed.getLocalized(FRAGMENT.id, 'en'))?.localized.content).toEqual({
          mdx: outcome === 'success' ? '# Shared footer explicitly saved draft' : '# Shared footer',
        });
        await expect((await delayed.getLocalized(FRAGMENT.id, 'nl'))?.localized.content).toEqual({
          mdx: '# Voettekst',
        });
      } finally {
        delayed.localeReply.resolve();
        delayed.writeReply.resolve();
      }
    },
  };
}

export const ExplicitSaveBeforeLocaleConflict: Story = explicitSaveRace('conflict');
export const ExplicitSaveBeforeLocaleError: Story = explicitSaveRace('error');
export const ExplicitSaveBeforeLocaleSuccess: Story = explicitSaveRace('success');
export const ExplicitSaveErrorBeforeLocale: Story = explicitSaveRace('error', true);
/** Uses the production BaseMDXEditor document shortcut, which CMSMDXEditor forwards through unchanged. */
export const StandaloneKeyboardSaveBeforeLocale: Story = explicitSaveRace('error', false, true);
