/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, type Mock, mock, onTestFinished, spyOn, test } from 'bun:test';
import { ContentAPIClient, getContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureUI } from '../../ui-config.js';
import { CreatePageDialog } from './CreatePageDialog.js';

const TAKEN_MESSAGE = 'This pathname is already in use';
const CHECKING_MESSAGE = 'Checking availability...';
const CHECK_FAILED_MESSAGE = 'Could not check if this path is free.';

type Availability = (site: string, pathname: string, excludeId?: string, locale?: string) => Promise<boolean>;

// What a host that does not serve the local CMS routes answers for any path:
// its own HTML shell, with a 200. The dialog must not depend on that request.
const htmlShell = () =>
  Promise.resolve(new Response('<!doctype html><html></html>', { headers: { 'Content-Type': 'text/html' } }));

let previousClient: ContentAPIClient;
let previousFetch: typeof fetch;
let fetchStub: Mock<typeof htmlShell>;

beforeEach(() => {
  previousClient = getContentAPIClient();
  previousFetch = globalThis.fetch;
  fetchStub = mock(htmlShell);
  globalThis.fetch = Object.assign(fetchStub, { preconnect: () => {} });
});

afterEach(() => {
  globalThis.fetch = previousFetch;
  setContentAPIClient(previousClient);
  configureUI({});
});

/** Install the content client the dialog must ask, the way a host does. */
function installClient(answer: Availability) {
  const isPathnameAvailable = mock(answer);
  const client = new ContentAPIClient();
  client.isPathnameAvailable = isPathnameAvailable;
  setContentAPIClient(client);
  return isPathnameAvailable;
}

/** Answers like a site where exactly one page exists, at `taken` in `takenLocale`. */
function onePageAt(taken: string, takenLocale = 'en'): Availability {
  return async (_site, pathname, _excludeId, locale) => !(pathname === taken && locale === takenLocale);
}

type OpenCheck = { resolve: (available: boolean) => void; reject: (error: Error) => void };

/**
 * Install a content client that holds every check open until the test settles
 * it, so the test decides which of two overlapping checks answers first. The
 * returned lookup waits for the dialog to ask about `pathname` and hands over
 * that check.
 */
function installHoldingClient() {
  const open = new Map<string, OpenCheck>();
  installClient(
    (_site, pathname) =>
      new Promise<boolean>((resolve, reject) => {
        open.set(pathname, { resolve, reject });
      }),
  );
  return async function openCheck(pathname: string): Promise<OpenCheck> {
    const check = await waitFor(() => {
      const found = open.get(pathname);
      if (!found) throw new Error(`The dialog has not checked ${pathname} yet`);
      return found;
    });
    open.delete(pathname);
    return check;
  };
}

function typeTitle(title: string) {
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: title } });
}

function typePath(path: string) {
  fireEvent.change(screen.getByLabelText('URL Path'), { target: { value: path } });
}

function createButton() {
  return screen.getByTestId('create-page-submit') as HTMLButtonElement;
}

/** A failed check is logged; keep that out of the test output. */
function silenceCheckFailureLog() {
  const consoleError = spyOn(console, 'error').mockImplementation(() => {});
  onTestFinished(() => consoleError.mockRestore());
  return consoleError;
}

describe('CreatePageDialog pathname check', () => {
  test('warns and blocks Create when the pathname is already in use', async () => {
    configureUI({});
    const isPathnameAvailable = installClient(onePageAt('/contact'));
    render(<CreatePageDialog open={true} site="default" />);

    typeTitle('Contact');

    expect(await screen.findByText(TAKEN_MESSAGE)).toBeTruthy();
    expect(createButton().disabled).toBe(true);
    expect(isPathnameAvailable).toHaveBeenCalledWith('default', '/contact', undefined, 'en');
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test('checks the pathname in the locale the page will be created in', async () => {
    configureUI({ locales: { list: ['en', 'de'], defaultLocale: 'en' } });
    const isPathnameAvailable = installClient(onePageAt('/kontakt', 'de'));
    render(<CreatePageDialog open={true} site="default" />);

    fireEvent.change(screen.getByLabelText('Primary Locale'), { target: { value: 'de' } });
    typeTitle('Kontakt');

    expect(await screen.findByText(TAKEN_MESSAGE)).toBeTruthy();
    expect(createButton().disabled).toBe(true);
    expect(isPathnameAvailable).toHaveBeenCalledWith('default', '/kontakt', undefined, 'de');

    fireEvent.change(screen.getByLabelText('Primary Locale'), { target: { value: 'en' } });

    await waitFor(() => expect(createButton().disabled).toBe(false));
    expect(screen.queryByText(TAKEN_MESSAGE)).toBeNull();
    expect(isPathnameAvailable).toHaveBeenCalledWith('default', '/kontakt', undefined, 'en');
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test('lets a free pathname through without a warning', async () => {
    configureUI({});
    const isPathnameAvailable = installClient(onePageAt('/contact'));
    render(<CreatePageDialog open={true} site="default" />);

    typeTitle('Brand New');

    await waitFor(() => expect(isPathnameAvailable).toHaveBeenCalledWith('default', '/brand-new', undefined, 'en'));
    await waitFor(() => expect(createButton().disabled).toBe(false));
    expect(screen.queryByText(TAKEN_MESSAGE)).toBeNull();
  });

  test('keeps Create disabled for a new pathname until that pathname is checked', async () => {
    configureUI({});
    const onCreatePage = mock(() => {});
    const openCheck = installHoldingClient();
    render(<CreatePageDialog open={true} site="default" onCreatePage={onCreatePage} />);

    typeTitle('Brand New');
    const brandNew = await openCheck('/brand-new');
    await act(async () => brandNew.resolve(true));
    expect(createButton().disabled).toBe(false);

    // Before the dialog even asks about '/contact', the answer for
    // '/brand-new' must not let a quick click create a page there.
    typePath('/contact');
    expect(createButton().disabled).toBe(true);
    fireEvent.click(createButton());
    expect(onCreatePage).not.toHaveBeenCalled();

    const contact = await openCheck('/contact');
    await act(async () => contact.resolve(false));
    expect(screen.getByText(TAKEN_MESSAGE)).toBeTruthy();
    expect(createButton().disabled).toBe(true);
  });

  test('keeps Create disabled for a new locale until the pathname is checked in it', async () => {
    configureUI({ locales: { list: ['en', 'de'], defaultLocale: 'en' } });
    const onCreatePage = mock(() => {});
    const openCheck = installHoldingClient();
    render(<CreatePageDialog open={true} site="default" onCreatePage={onCreatePage} />);

    typeTitle('Kontakt');
    const english = await openCheck('/kontakt');
    await act(async () => english.resolve(true));
    expect(createButton().disabled).toBe(false);

    fireEvent.change(screen.getByLabelText('Primary Locale'), { target: { value: 'de' } });
    expect(createButton().disabled).toBe(true);
    fireEvent.click(createButton());
    expect(onCreatePage).not.toHaveBeenCalled();

    const german = await openCheck('/kontakt');
    await act(async () => german.resolve(false));
    expect(screen.getByText(TAKEN_MESSAGE)).toBeTruthy();
    expect(createButton().disabled).toBe(true);
  });

  test('ignores a late answer for a pathname the author already moved away from', async () => {
    configureUI({});
    const openCheck = installHoldingClient();
    render(<CreatePageDialog open={true} site="default" />);

    typeTitle('Contact');
    const contact = await openCheck('/contact');
    typePath('/brand-new');
    const brandNew = await openCheck('/brand-new');
    await act(async () => brandNew.resolve(true));
    expect(createButton().disabled).toBe(false);

    await act(async () => contact.resolve(false));

    expect(screen.queryByText(TAKEN_MESSAGE)).toBeNull();
    expect(createButton().disabled).toBe(false);
  });

  test('keeps waiting for the newer pathname when the abandoned check answers first', async () => {
    configureUI({});
    const openCheck = installHoldingClient();
    render(<CreatePageDialog open={true} site="default" />);

    typeTitle('Contact');
    const contact = await openCheck('/contact');
    typePath('/about');
    const about = await openCheck('/about');
    expect(await screen.findByText(CHECKING_MESSAGE, {}, { timeout: 2000 })).toBeTruthy();

    await act(async () => contact.resolve(false));

    expect(createButton().disabled).toBe(true);
    expect(screen.getByText(CHECKING_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(TAKEN_MESSAGE)).toBeNull();

    await act(async () => about.resolve(true));

    expect(createButton().disabled).toBe(false);
    expect(screen.queryByText(CHECKING_MESSAGE)).toBeNull();
    expect(screen.queryByText(TAKEN_MESSAGE)).toBeNull();
  });

  test('keeps the last answer and keeps waiting when the abandoned check fails first', async () => {
    configureUI({});
    const consoleError = silenceCheckFailureLog();
    const openCheck = installHoldingClient();
    render(<CreatePageDialog open={true} site="default" />);

    typeTitle('About');
    const firstAbout = await openCheck('/about');
    await act(async () => firstAbout.resolve(false));
    expect(screen.getByText(TAKEN_MESSAGE)).toBeTruthy();
    // The author tries another pathname, then goes back before that check answers.
    typePath('/contact');
    const contact = await openCheck('/contact');
    typePath('/about');
    const about = await openCheck('/about');
    expect(await screen.findByText(CHECKING_MESSAGE, {}, { timeout: 2000 })).toBeTruthy();

    await act(async () => contact.reject(new Error('network down')));

    expect(consoleError).toHaveBeenCalledWith('Failed to check pathname availability:', expect.any(Error));
    expect(createButton().disabled).toBe(true);
    expect(screen.getByText(CHECKING_MESSAGE)).toBeTruthy();
    expect(screen.getByText(TAKEN_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(CHECK_FAILED_MESSAGE)).toBeNull();

    await act(async () => about.resolve(false));

    expect(createButton().disabled).toBe(true);
    expect(screen.queryByText(CHECKING_MESSAGE)).toBeNull();
    expect(screen.getByText(TAKEN_MESSAGE)).toBeTruthy();
  });

  test('waits before saying it is checking, even after an abandoned slow check', async () => {
    configureUI({});
    const openCheck = installHoldingClient();
    render(<CreatePageDialog open={true} site="default" />);

    typeTitle('Contact');
    const contact = await openCheck('/contact');
    typePath('/brand-new');
    const brandNew = await openCheck('/brand-new');
    await act(async () => brandNew.resolve(true));
    expect(createButton().disabled).toBe(false);
    // The dialog says it is checking only once a check has run for 500ms; let
    // the abandoned '/contact' check outlive that before it finally answers.
    await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
    await act(async () => contact.resolve(true));

    typePath('/slow');
    await waitFor(() => expect(createButton().disabled).toBe(true));

    expect(screen.queryByText(CHECKING_MESSAGE)).toBeNull();
    expect(await screen.findByText(CHECKING_MESSAGE, {}, { timeout: 2000 })).toBeTruthy();
  });
});

describe('CreatePageDialog with a template whose pages live under a path prefix', () => {
  const blogTemplate = { blog: { label: 'Blog Post', component: 'BlogPostTemplate', pathPrefix: '/blog/' } };

  function chooseTemplate(key: string) {
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: key } });
  }

  test('checks the path under the prefix when the author types one without it, and says so', async () => {
    configureUI({ templates: blogTemplate });
    const isPathnameAvailable = installClient(onePageAt('/blog/hello'));
    render(<CreatePageDialog open={true} site="default" />);

    chooseTemplate('blog');
    typePath('/hello');

    expect(await screen.findByText(TAKEN_MESSAGE)).toBeTruthy();
    expect(screen.getByText('The page will be created at /blog/hello')).toBeTruthy();
    expect(createButton().disabled).toBe(true);
    expect(isPathnameAvailable).toHaveBeenCalledWith('default', '/blog/hello', undefined, 'en');
    expect(isPathnameAvailable).not.toHaveBeenCalledWith('default', '/hello', undefined, 'en');
  });

  test('creates the page at the path it checked', async () => {
    configureUI({ templates: blogTemplate });
    const onCreatePage = mock(() => {});
    const isPathnameAvailable = installClient(onePageAt('/contact'));
    render(<CreatePageDialog open={true} site="default" onCreatePage={onCreatePage} />);

    chooseTemplate('blog');
    typeTitle('Hello');
    typePath('/hello');
    await waitFor(() => expect(createButton().disabled).toBe(false));
    fireEvent.click(createButton());

    expect(onCreatePage).toHaveBeenCalledWith(expect.objectContaining({ path: '/blog/hello', template: 'blog' }));
    expect(isPathnameAvailable).not.toHaveBeenCalledWith('default', '/hello', undefined, 'en');
  });

  test('leaves a path that already starts with the prefix as it is', async () => {
    configureUI({ templates: blogTemplate });
    const onCreatePage = mock(() => {});
    installClient(onePageAt('/contact'));
    render(<CreatePageDialog open={true} site="default" onCreatePage={onCreatePage} />);

    chooseTemplate('blog');
    typeTitle('Hello');
    await waitFor(() => expect(createButton().disabled).toBe(false));
    fireEvent.click(createButton());

    expect(onCreatePage).toHaveBeenCalledWith(expect.objectContaining({ path: '/blog/hello' }));
    expect(screen.queryByText(/The page will be created at/)).toBeNull();
  });

  // A path is under the prefix only when the prefix is its whole first segment, with or without
  // the prefix's trailing slash: '/blogging' is not a blog page, and '/blog' is the blog itself.
  test.each([
    { pathPrefix: '/blog', typed: '/blogging', created: '/blog/blogging' },
    { pathPrefix: '/blog/', typed: '/blog', created: '/blog' },
    { pathPrefix: '/blog', typed: '/blog/post', created: '/blog/post' },
    { pathPrefix: '/blog/', typed: '/blog/post', created: '/blog/post' },
  ])('with the prefix $pathPrefix, checks and creates $typed at $created', async ({ pathPrefix, typed, created }) => {
    configureUI({ templates: { blog: { label: 'Blog Post', component: 'BlogPostTemplate', pathPrefix } } });
    const onCreatePage = mock(() => {});
    const isPathnameAvailable = installClient(onePageAt('/contact'));
    render(<CreatePageDialog open={true} site="default" onCreatePage={onCreatePage} />);

    chooseTemplate('blog');
    typeTitle('Post');
    typePath(typed);
    await waitFor(() => expect(createButton().disabled).toBe(false));
    fireEvent.click(createButton());

    expect(isPathnameAvailable).toHaveBeenLastCalledWith('default', created, undefined, 'en');
    expect(onCreatePage).toHaveBeenCalledWith(expect.objectContaining({ path: created }));
  });
});

describe('CreatePageDialog when the pathname check fails', () => {
  // What the local content API answers when it cannot look the path up at all.
  test.each([
    {
      status: 404,
      error: { code: 'SITE_NOT_FOUND', message: "Site 'default' not found", details: { site: 'default' } },
    },
    { status: 500, error: { code: 'INTERNAL_ERROR', message: 'Failed to check pathname availability' } },
  ])('blocks Create when the local content API answers the check with a $status error', async ({ status, error }) => {
    configureUI({});
    silenceCheckFailureLog();
    fetchStub.mockImplementation(() => Promise.resolve(Response.json({ error }, { status })));
    setContentAPIClient(new ContentAPIClient());
    render(<CreatePageDialog open={true} site="default" />);

    typeTitle('Contact');

    expect(await screen.findByText(CHECK_FAILED_MESSAGE)).toBeTruthy();
    expect(createButton().disabled).toBe(true);
    expect(screen.queryByText(TAKEN_MESSAGE)).toBeNull();
    expect(fetchStub).toHaveBeenCalledWith(expect.stringContaining('/default/pathname-available?pathname=%2Fcontact'));
  });

  test('blocks Create while the host content client cannot check, and lets the author check again', async () => {
    configureUI({});
    silenceCheckFailureLog();
    const openCheck = installHoldingClient();
    render(<CreatePageDialog open={true} site="default" />);

    typeTitle('Contact');
    const contact = await openCheck('/contact');
    await act(async () => contact.reject(new TypeError('Failed to fetch')));

    expect(screen.getByText(CHECK_FAILED_MESSAGE)).toBeTruthy();
    expect(createButton().disabled).toBe(true);
    expect(screen.queryByText(TAKEN_MESSAGE)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    const retry = await openCheck('/contact');

    expect(screen.queryByText(CHECK_FAILED_MESSAGE)).toBeNull();
    expect(createButton().disabled).toBe(true);

    await act(async () => retry.resolve(true));

    expect(screen.queryByText(CHECK_FAILED_MESSAGE)).toBeNull();
    expect(createButton().disabled).toBe(false);
  });
});

describe('CreatePageDialog when the author types the URL path', () => {
  const blogTemplate = { blog: { label: 'Blog Post', component: 'BlogPostTemplate', pathPrefix: '/blog/' } };

  function pathInput() {
    return screen.getByLabelText('URL Path') as HTMLInputElement;
  }

  test('keeps the typed path when the title changes afterwards', async () => {
    configureUI({});
    installClient(onePageAt('/contact'));
    render(<CreatePageDialog open={true} site="default" />);

    typeTitle('Фото галерея');
    typePath('/foto');
    typeTitle('Фото галерея 2024');

    expect(pathInput().value).toBe('/foto');
    await waitFor(() => expect(createButton().disabled).toBe(false));
  });

  test('keeps the typed path when the template changes, and creates the page under its prefix', async () => {
    configureUI({ templates: blogTemplate });
    installClient(onePageAt('/contact'));
    render(<CreatePageDialog open={true} site="default" />);

    typeTitle('Hello');
    typePath('/greeting');
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'blog' } });

    expect(pathInput().value).toBe('/greeting');
    expect(screen.getByText('The page will be created at /blog/greeting')).toBeTruthy();
    await waitFor(() => expect(createButton().disabled).toBe(false));
  });

  // The path made from the title carries the template's prefix, so the one the author edits from it
  // does too: another template's prefix must replace it, not go in front of it.
  describe('and then picks another template', () => {
    const templates = {
      ...blogTemplate,
      news: { label: 'News', component: 'NewsTemplate', pathPrefix: '/news/' },
    };

    test('moves a path under the old prefix to the new one, keeping what the author typed', async () => {
      configureUI({ templates });
      const onCreatePage = mock(() => {});
      installClient(onePageAt('/contact'));
      render(<CreatePageDialog open={true} site="default" onCreatePage={onCreatePage} />);

      fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'blog' } });
      typeTitle('Hello');
      typePath('/blog/hello-2');
      fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'news' } });

      expect(pathInput().value).toBe('/news/hello-2');
      expect(screen.queryByText(/The page will be created at/)).toBeNull();
      await waitFor(() => expect(createButton().disabled).toBe(false));
      fireEvent.click(createButton());
      expect(onCreatePage).toHaveBeenCalledWith(expect.objectContaining({ path: '/news/hello-2', template: 'news' }));
    });

    // 'blog/hello-2' is created at '/blog/hello-2' under Blog, so it is under the old prefix too.
    test('moves a path typed without its leading slash', async () => {
      configureUI({ templates });
      const onCreatePage = mock(() => {});
      installClient(onePageAt('/contact'));
      render(<CreatePageDialog open={true} site="default" onCreatePage={onCreatePage} />);

      fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'blog' } });
      typeTitle('Hello');
      typePath('blog/hello-2');
      fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'news' } });

      expect(pathInput().value).toBe('/news/hello-2');
      await waitFor(() => expect(createButton().disabled).toBe(false));
      fireEvent.click(createButton());
      expect(onCreatePage).toHaveBeenCalledWith(expect.objectContaining({ path: '/news/hello-2', template: 'news' }));
    });

    test('takes the old prefix off when the new template has none', () => {
      configureUI({ templates });
      installClient(onePageAt('/contact'));
      render(<CreatePageDialog open={true} site="default" />);

      fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'blog' } });
      typeTitle('Hello');
      typePath('/blog/hello-2');
      fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'blank' } });

      expect(pathInput().value).toBe('/hello-2');
    });
  });

  test('makes the path from the title again once the author clears it', async () => {
    configureUI({});
    installClient(onePageAt('/contact'));
    render(<CreatePageDialog open={true} site="default" />);

    typeTitle('Hello');
    typePath('/custom');
    typePath('');
    typeTitle('Hello World');

    expect(pathInput().value).toBe('/hello-world');
    await waitFor(() => expect(createButton().disabled).toBe(false));
  });
});

describe('CreatePageDialog with a title that has no letters a–z or digits', () => {
  const NO_PATH_HINT = 'Type a path: the title has no letters a–z or digits.';

  test('asks the author to type the URL path the title cannot make', () => {
    configureUI({});
    installClient(onePageAt('/contact'));
    render(<CreatePageDialog open={true} site="default" />);

    typeTitle('Фото галерея');

    expect(screen.getByText(NO_PATH_HINT)).toBeTruthy();
    expect(createButton().disabled).toBe(true);
  });

  test('stops asking once the author types a path', async () => {
    configureUI({});
    installClient(onePageAt('/contact'));
    render(<CreatePageDialog open={true} site="default" />);

    typeTitle('Фото галерея');
    typePath('/foto');

    expect(screen.queryByText(NO_PATH_HINT)).toBeNull();
    await waitFor(() => expect(createButton().disabled).toBe(false));
  });
});
