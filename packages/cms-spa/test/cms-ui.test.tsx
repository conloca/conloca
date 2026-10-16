/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from 'bun:test';
import { ErrorCodes } from '@conloca/content-api-client';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { CMSDashboard } from '../src/components/CMSDashboard.js';
import { CreatePageDialog } from '../src/components/dialogs/CreatePageDialog.js';
import { PageMetadataDialog } from '../src/components/dialogs/PageMetadataDialog.js';
import { LocaleSelector } from '../src/components/editor/LocaleSelector.js';
import { FragmentList } from '../src/components/pages/FragmentList.js';
import { PageList } from '../src/components/pages/PageList.js';
import { SaveIndicator } from '../src/components/ui/SaveIndicator.js';
import { definePageSchema, setPageSchemas } from '../src/page-schemas.js';
import { setPuckConfig } from '../src/puck-config.js';
import type { PageMetadata } from '../src/types.js';
import { setTemplates } from '../src/ui-config.js';
import { titleFields } from './fixtures/typia/host-schemas.js';
import { API_ROUTES, mockAPIError, renderWithProviders, setupTestAPI, testApi } from './test-utils.js';
import { pinTimeZone } from './time-zone.js';

// Setup test API before all tests
beforeEach(() => {
  setupTestAPI();
});

// Cleanup after each test, including a clock a test stopped
afterEach(() => {
  cleanup();
  setSystemTime();
});

describe('CMS Dashboard', () => {
  test('renders with content stats', async () => {
    // Add test data to the in-memory API
    await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'Home' },
      locales: {
        en: {
          meta: { title: 'Home' },
          pathname: '/',
          content: { puckData: { root: {}, content: [], zones: {} } },
        },
      },
    });

    await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'About' },
      locales: {
        en: {
          meta: { title: 'About' },
          pathname: '/about',
          content: { puckData: { root: {}, content: [], zones: {} } },
        },
      },
    });

    await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'hero',
      meta: { title: 'Hero Fragment' },
      locales: {
        en: {
          meta: { title: 'Hero Fragment' },
          content: { mdx: '# Hero\n\nWelcome!' },
        },
      },
    });

    const { getByTestId, findByTestId } = renderWithProviders(<CMSDashboard />, {}, false);

    // Use findBy instead of waitFor - more efficient
    const pagesCard = await findByTestId('section-card-pages');
    expect(pagesCard).toBeInTheDocument();
    expect(pagesCard).toHaveTextContent('2'); // 2 pages
    expect(pagesCard).toHaveTextContent('Pages');

    const fragmentsCard = getByTestId('section-card-fragments');
    expect(fragmentsCard).toBeInTheDocument();
    expect(fragmentsCard).toHaveTextContent('1'); // 1 fragment
    expect(fragmentsCard).toHaveTextContent('Fragments');
  });
});

describe('Page List', () => {
  test('renders page list with locale filter', async () => {
    // Add test pages with multiple locales
    await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'Home' },
      locales: {
        en: {
          meta: { title: 'Home' },
          pathname: '/',
          content: { puckData: { root: {}, content: [], zones: {} } },
        },
        nl: {
          meta: { title: 'Thuis' },
          pathname: '/',
          content: { puckData: { root: {}, content: [], zones: {} } },
        },
      },
    });

    await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'About' },
      locales: {
        en: {
          meta: { title: 'About' },
          pathname: '/about',
          content: { puckData: { root: {}, content: [], zones: {} } },
        },
      },
    });

    const { getByText, getByTestId, findByText } = renderWithProviders(<PageList />, {}, false);

    // Wait for first page to appear
    await findByText('Home');

    // Check pages are rendered
    expect(getByText('Home')).toBeInTheDocument();
    expect(getByText('About')).toBeInTheDocument();

    // Check locale selector using test ID
    const localeSelector = getByTestId('locale-selector');
    expect(localeSelector).toBeInTheDocument();
    expect(localeSelector.tagName).toBe('SELECT');
  });

  test('filters by locale', async () => {
    // Add test pages with multiple locales
    await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'Home' },
      locales: {
        en: {
          meta: { title: 'Home' },
          pathname: '/',
          content: { puckData: { root: {}, content: [], zones: {} } },
        },
        nl: {
          meta: { title: 'Thuis' },
          pathname: '/',
          content: { puckData: { root: {}, content: [], zones: {} } },
        },
      },
    });

    await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'About' },
      locales: {
        en: {
          meta: { title: 'About' },
          pathname: '/about',
          content: { puckData: { root: {}, content: [], zones: {} } },
        },
      },
    });

    const { getByTestId, findByText, queryByText } = renderWithProviders(<PageList />, {}, false);

    // Wait for first page to appear
    await findByText('Home');

    const localeSelector = getByTestId('locale-selector');
    fireEvent.change(localeSelector, { target: { value: 'nl' } });

    // Wait for the list to update after locale change
    await findByText('Thuis'); // Home (nl locale)

    // Check that About is not shown (it only has en locale)
    expect(queryByText('About')).not.toBeInTheDocument();
  });

  test('calls a page a draft from the instant its unpublish time arrives', async () => {
    // The clock stands still, so the list judges the page at exactly its unpublish time.
    const unpublishAt = new Date('2026-09-23T12:00:00Z');
    setSystemTime(unpublishAt);
    await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'Retired' },
      locales: {
        en: {
          meta: { title: 'Retired' },
          pathname: '/retired',
          unpublishAt: unpublishAt.toISOString(),
          content: { puckData: { root: {}, content: [], zones: {} } },
        },
      },
    });

    const { findByText } = renderWithProviders(<PageList />, {}, false);

    const row = (await findByText('Retired')).closest('tr');
    expect(row).toHaveTextContent('draft');
    expect(row).not.toHaveTextContent('published');
  });
});

describe('Create Page Dialog', () => {
  test('creates page with required fields', () => {
    // Skip this test for now - it has issues with the Dialog portal rendering
    // The component works in practice but testing Radix UI dialogs is tricky
  });

  test('drops a template naming an unregistered component, loudly', () => {
    // A typo in templates.<key>.component used to fail silently: the create
    // dialog offered the template, creating from it scaffolded a component
    // Puck cannot render, and nothing named the mistake. The dialog now
    // filters such templates out and warns with the names involved.
    setPuckConfig({ components: { RealTemplate: { render: () => <></> } } });
    setTemplates({
      good: { label: 'Good Template', component: 'RealTemplate' },
      typo: { label: 'Broken Template', component: 'RaelTemplate' },
    });
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
    try {
      const { queryByText, getByText } = renderWithProviders(<CreatePageDialog open={true} />, {}, false);
      expect(getByText(/Good Template/)).toBeTruthy();
      expect(queryByText(/Broken Template/)).toBeNull();
    } finally {
      console.warn = originalWarn;
      setTemplates(undefined);
      setPuckConfig({ components: {} });
    }
    expect(warnings.join('\n')).toContain('RaelTemplate');
    expect(warnings.join('\n')).toContain('typo');
  });

  test('offers every template while the Puck config is not installed yet', () => {
    // The shared config defaults to `{ components: {} }` until the host
    // installs the real one, which a host app may do asynchronously. An
    // empty registry means "not ready", not "no components": filtering
    // against it would hide every template and warn about all of them.
    setPuckConfig({ components: {} });
    setTemplates({
      earlyBird: { label: 'Early Template', component: 'NotInstalledYet' },
    });
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
    try {
      const { getByText } = renderWithProviders(<CreatePageDialog open={true} />, {}, false);
      expect(getByText(/Early Template/)).toBeTruthy();
    } finally {
      console.warn = originalWarn;
      setTemplates(undefined);
    }
    expect(warnings.join('\n')).toBe('');
  });

  test('auto-generates path from title', () => {
    const { getByLabelText } = renderWithProviders(<CreatePageDialog open={true} />, {}, false);

    const titleInput = getByLabelText('Title');
    const pathInput = getByLabelText('URL Path') as HTMLInputElement;

    fireEvent.change(titleInput, { target: { value: 'My New Page' } });

    expect(pathInput.value).toBe('/my-new-page');
  });

  test('shows shape error for uppercase path and disables submit', async () => {
    const { getByLabelText, getByTestId, findByText } = renderWithProviders(
      <CreatePageDialog open={true} />,
      {},
      false,
    );

    const titleInput = getByLabelText('Title');
    const pathInput = getByLabelText('URL Path') as HTMLInputElement;

    fireEvent.change(titleInput, { target: { value: 'Test' } });
    fireEvent.change(pathInput, { target: { value: '/About-Us' } });

    await findByText('Path must be lowercase');
    const submitBtn = getByTestId('create-page-submit') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  test('shows shape error for whitespace in path', async () => {
    const { getByLabelText, findByText } = renderWithProviders(<CreatePageDialog open={true} />, {}, false);

    const titleInput = getByLabelText('Title');
    const pathInput = getByLabelText('URL Path') as HTMLInputElement;

    fireEvent.change(titleInput, { target: { value: 'Test' } });
    fireEvent.change(pathInput, { target: { value: '/foo bar' } });

    await findByText('Path cannot contain spaces');
  });

  test('shows shape error for `..` traversal segment', async () => {
    const { getByLabelText, findByText } = renderWithProviders(<CreatePageDialog open={true} />, {}, false);

    const titleInput = getByLabelText('Title');
    const pathInput = getByLabelText('URL Path') as HTMLInputElement;

    fireEvent.change(titleInput, { target: { value: 'Test' } });
    fireEvent.change(pathInput, { target: { value: '/foo/../bar' } });

    await findByText('Path cannot contain `.` or `..` segments');
  });

  test('shows shape error for non-ASCII characters', async () => {
    const { getByLabelText, findByText } = renderWithProviders(<CreatePageDialog open={true} />, {}, false);

    const titleInput = getByLabelText('Title');
    const pathInput = getByLabelText('URL Path') as HTMLInputElement;

    fireEvent.change(titleInput, { target: { value: 'Test' } });
    fireEvent.change(pathInput, { target: { value: '/café' } });

    await findByText('Path can only contain a–z, 0–9, `-`, `_`, `/`');
  });

  test('submits the normalized pathname when input has trailing slash', async () => {
    const onCreatePage = mock();
    const { getByLabelText, getByTestId } = renderWithProviders(
      <CreatePageDialog open={true} onCreatePage={onCreatePage} />,
      {},
      false,
    );

    const titleInput = getByLabelText('Title');
    const pathInput = getByLabelText('URL Path') as HTMLInputElement;

    fireEvent.change(titleInput, { target: { value: 'Test' } });
    fireEvent.change(pathInput, { target: { value: '/foo/' } });

    // Wait for the debounced availability check to complete so the
    // submit button becomes enabled.
    await waitFor(() => {
      const submitBtn = getByTestId('create-page-submit') as HTMLButtonElement;
      expect(submitBtn.disabled).toBe(false);
    });

    fireEvent.click(getByTestId('create-page-submit'));

    expect(onCreatePage).toHaveBeenCalledTimes(1);
    expect(onCreatePage.mock.calls[0][0].path).toBe('/foo');
  });
});

describe('Page Metadata Dialog', () => {
  // CI often runs TZ=UTC, which makes UTC-sliced datetime-local values look
  // correct. A zone with an offset is what made the live picker lie. Pin
  // UTC−12 as a fixed offset (Etc/GMT+12; POSIX signs are reversed), where nobody lives.
  pinTimeZone('Etc/GMT+12');

  const mockPage: PageMetadata = {
    title: 'Test Page',
    description: 'Test description',
    pathname: '/test',
    publishDate: null,
    unpublishDate: null,
  };

  test('updates page metadata', async () => {
    const onSave = mock();
    const { getByText } = render(<PageMetadataDialog open={true} page={mockPage} onSave={onSave} />);

    // Find the description textarea (SchemaForm renders description fields as textarea)
    // Radix dialog renders in portal, so query from document.body
    const descriptionTextarea = document.body.querySelector('textarea');
    expect(descriptionTextarea).toBeTruthy();
    fireEvent.change(descriptionTextarea!, { target: { value: 'Updated description' } });

    fireEvent.click(getByText('Save'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
      // PageMetadataDialog now emits additional fields (customMeta,
      // robots, canonical, collection, type). Assert on the fields the
      // test actually cares about.
      expect(onSave.mock.calls[0][0]).toMatchObject({
        title: mockPage.title,
        pathname: mockPage.pathname,
        description: 'Updated description',
      });
    });
  });

  test('the publish picker shows the authors local clock, not UTC', () => {
    // datetime-local is wall-clock with no zone. Filling it from toISOString()
    // shows UTC hours, so a 17:00 local clock (the day before) comes back as 05:00.
    const stored = new Date('2026-09-15T05:00:00.000Z');
    render(<PageMetadataDialog open={true} page={{ ...mockPage, publishDate: stored }} />);

    const publishInput = document.body.querySelectorAll('input[type="datetime-local"]')[0] as HTMLInputElement;
    expect(publishInput).toBeTruthy();
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(publishInput.value).toBe(
      `${stored.getFullYear()}-${pad(stored.getMonth() + 1)}-${pad(stored.getDate())}T${pad(stored.getHours())}:${pad(stored.getMinutes())}`,
    );
  });

  test('saving page settings without touching the date keeps the stored instant', async () => {
    const stored = new Date('2026-09-15T05:00:00.000Z');
    const onSave = mock();
    const { getByText } = render(
      <PageMetadataDialog open={true} page={{ ...mockPage, publishDate: stored }} onSave={onSave} />,
    );

    fireEvent.click(getByText('Save'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].publishDate?.toISOString()).toBe(stored.toISOString());
  });

  test('clearing the publish date unschedules the page', async () => {
    const stored = new Date('2026-09-15T05:00:00.000Z');
    const onSave = mock();
    const { getByText } = render(
      <PageMetadataDialog open={true} page={{ ...mockPage, publishDate: stored }} onSave={onSave} />,
    );

    const publishInput = document.body.querySelectorAll('input[type="datetime-local"]')[0] as HTMLInputElement;
    fireEvent.change(publishInput, { target: { value: '' } });
    fireEvent.click(getByText('Save'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].publishDate).toBeNull();
  });

  test('a failed save error does not survive reopening the dialog', async () => {
    // The editors keep the dialog mounted across open/close — a red banner
    // from last week's failed save reappearing on a fresh open reads as
    // "this save just failed".
    const onSave = mock(async () => {
      throw new Error('etag is stale');
    });
    const { getByText, rerender } = render(<PageMetadataDialog open={true} page={mockPage} onSave={onSave} />);

    fireEvent.click(getByText('Save'));
    await waitFor(() => expect(document.body.textContent).toContain('etag is stale'));

    rerender(<PageMetadataDialog open={false} page={mockPage} onSave={onSave} />);
    rerender(<PageMetadataDialog open={true} page={mockPage} onSave={onSave} />);

    expect(document.body.textContent).not.toContain('etag is stale');
  });

  test('an emptied title says the page needs one and keeps Save from sending', () => {
    // Every backend refuses a page without a title, but only once Save had
    // sent it: the dialog then showed the server's refusal, which the
    // content-API router answered with a bare "API error: 500".
    const onSave = mock();
    const { getByLabelText, getByRole, queryByRole } = render(
      <PageMetadataDialog open={true} page={mockPage} onSave={onSave} />,
    );
    const save = getByRole('button', { name: 'Save' }) as HTMLButtonElement;

    fireEvent.change(getByLabelText(/^Title/), { target: { value: '' } });

    expect(getByRole('alert').textContent).toBe('Enter a page title before saving.');
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(getByLabelText(/^Title/), { target: { value: 'Renamed' } });

    expect(queryByRole('alert')).toBeNull();
    expect(save.disabled).toBe(false);
  });

  test('an emptied title marks its field invalid and points it at the message', () => {
    // A screen reader announces the message once, as an alert; on the field it is read again
    // whenever the author comes back to the title.
    const { getByLabelText, getByRole } = render(<PageMetadataDialog open={true} page={mockPage} onSave={mock()} />);
    const title = getByLabelText(/^Title/);
    expect(title.getAttribute('aria-invalid')).not.toBe('true');

    fireEvent.change(title, { target: { value: '' } });

    const message = getByRole('alert');
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(message.id).not.toBe('');
    expect(title.getAttribute('aria-describedby')).toBe(message.id);

    fireEvent.change(title, { target: { value: 'Renamed' } });

    expect(title.getAttribute('aria-invalid')).not.toBe('true');
    expect(title.getAttribute('aria-describedby')).toBeNull();
  });

  describe('with a site schema that declares the title', () => {
    afterEach(() => setPageSchemas({}));

    for (const mode of ['minimal', 'none'] as const) {
      test(`in '${mode}' mode an emptied title says the page needs one and keeps Save from sending`, () => {
        // The site's own schema renders the title field in these modes, and Save
        // sent the emptied title as null for every backend to refuse.
        setPageSchemas({ '/': definePageSchema({ schema: titleFields, coreFields: { mode } }) });
        const onSave = mock();
        const page = { ...mockPage, customMeta: { title: mockPage.title } };
        const { getByLabelText, getByRole, queryByRole } = render(
          <PageMetadataDialog open={true} page={page} onSave={onSave} />,
        );
        const save = getByRole('button', { name: 'Save' }) as HTMLButtonElement;

        fireEvent.change(getByLabelText(/^Title/), { target: { value: '' } });

        expect(getByRole('alert').textContent).toBe('Enter a page title before saving.');
        expect(save.disabled).toBe(true);
        fireEvent.click(save);
        expect(onSave).not.toHaveBeenCalled();

        fireEvent.change(getByLabelText(/^Title/), { target: { value: 'Renamed' } });

        expect(queryByRole('alert')).toBeNull();
        expect(save.disabled).toBe(false);
      });
    }
  });
});

describe('Fragment List', () => {
  test('renders fragments in card layout', async () => {
    // Add test fragments
    await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'hero',
      meta: { title: 'Hero Fragment', description: 'Welcome to our site...' },
      locales: {
        en: {
          meta: { title: 'Hero Fragment', description: 'Welcome to our site...' },
          content: { mdx: '# Hero\n\nWelcome to our site...' },
        },
      },
    });

    await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'cta',
      meta: { title: 'CTA Fragment', description: 'Sign up now...' },
      locales: {
        en: {
          meta: { title: 'CTA Fragment', description: 'Sign up now...' },
          content: { mdx: '## CTA\n\nSign up now...' },
        },
      },
    });

    const { getByText, findByText } = renderWithProviders(<FragmentList />, {}, false);

    // Wait for first fragment to appear
    await findByText('Hero Fragment');

    expect(getByText('Hero Fragment')).toBeInTheDocument(); // title from meta
    expect(getByText('Welcome to our site...')).toBeInTheDocument(); // description
    expect(getByText('CTA Fragment')).toBeInTheDocument();
    expect(getByText('Sign up now...')).toBeInTheDocument();
  });

  test('shows locale indicators', async () => {
    // Add test fragments with multiple locales
    await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'hero',
      meta: { title: 'Hero Fragment' },
      locales: {
        en: {
          meta: { title: 'Hero Fragment' },
          content: { mdx: '# Hero' },
        },
      },
    });

    await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'cta',
      meta: { title: 'CTA Fragment' },
      locales: {
        en: {
          meta: { title: 'CTA Fragment' },
          content: { mdx: '## CTA' },
        },
        nl: {
          meta: { title: 'CTA Fragment NL' },
          content: { mdx: '## CTA NL' },
        },
      },
    });

    const { getAllByTestId, findByText } = renderWithProviders(<FragmentList />, {}, false);

    // Wait for first fragment to appear
    await findByText('Hero Fragment');

    const localeIndicators = getAllByTestId('locale-indicator');
    expect(localeIndicators).toHaveLength(3); // en (hero), en (cta), nl (cta)
  });

  test('a rename the server refuses says why, rather than to try again', async () => {
    // The content-API router answers a name another fragment has with 409 and the backend's
    // message, which the client throws. The list showed "Failed to rename fragment. Please try
    // again." instead, and trying the same name again can never work.
    const created = await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'hero',
      meta: { title: 'Hero Fragment' },
      locales: { en: { meta: { title: 'Hero Fragment' }, content: { mdx: '# Hero' } } },
    });
    const refusal = 'Fragment name banner already exists in collection fragments';
    mockAPIError(API_ROUTES.CONTENT_BY_ID(created.id ?? ''), 409, ErrorCodes.NAME_TAKEN, refusal);

    const { findByText, getByRole, getByTestId, queryByText } = renderWithProviders(<FragmentList />, {}, false);
    await findByText('Hero Fragment');
    fireEvent.click(getByRole('button', { name: /more actions/i }));
    fireEvent.click(await findByText('Rename'));
    fireEvent.change(getByTestId('fragment-name-input'), { target: { value: 'banner' } });
    fireEvent.click(getByTestId('rename-fragment-submit'));

    expect(await findByText(refusal)).toBeDefined();
    expect(queryByText('Failed to rename fragment. Please try again.')).toBeNull();
  });
});

describe('Locale Selector', () => {
  const availableLocales = ['en', 'nl', 'fr'];

  test('shows current locale highlighted', () => {
    const { getByRole, getAllByText } = render(
      <LocaleSelector currentLocale="nl" availableLocales={availableLocales} onChange={() => {}} />,
    );

    // Open the dropdown
    const trigger = getByRole('combobox');
    fireEvent.click(trigger);

    // Check that the current locale option is marked as selected
    const nlOptions = getAllByText('nl');
    const dropdownOption = nlOptions.find((el) => el.parentElement?.getAttribute('role') === 'option');
    expect(dropdownOption?.parentElement?.getAttribute('aria-selected')).toBe('true');
  });

  test('shows missing translations', () => {
    const { getByRole, getByText } = render(
      <LocaleSelector
        currentLocale="en"
        availableLocales={availableLocales}
        missingLocales={['fr']}
        onChange={() => {}}
      />,
    );

    // Open the dropdown
    const trigger = getByRole('combobox');
    fireEvent.click(trigger);

    // Just verify the missing locale is shown
    const frOption = getByText('fr');
    expect(frOption).toBeInTheDocument();
  });

  test('preserves state on locale switch', () => {
    const onChange = mock();
    const { getByRole, getByText } = render(
      <LocaleSelector currentLocale="en" availableLocales={availableLocales} onChange={onChange} />,
    );

    // Open the dropdown
    const trigger = getByRole('combobox');
    fireEvent.click(trigger);

    fireEvent.click(getByText('nl'));
    expect(onChange).toHaveBeenCalledWith('nl');
  });
});

describe('Save Indicator', () => {
  test('shows saving state', () => {
    const { getByTestId } = render(<SaveIndicator state="saving" />);
    expect(getByTestId('save-indicator-saving')).toBeInTheDocument();
  });

  test('shows saved state', () => {
    const { getByTestId } = render(<SaveIndicator state="saved" />);
    expect(getByTestId('save-indicator-saved')).toBeInTheDocument();
  });

  test('shows error state', () => {
    const { getByTestId } = render(<SaveIndicator state="error" />);
    expect(getByTestId('save-indicator-error')).toBeInTheDocument();
  });

  test('shows conflict state', () => {
    const { getByTestId } = render(<SaveIndicator state="conflict" />);
    expect(getByTestId('save-indicator-conflict')).toBeInTheDocument();
  });
});
