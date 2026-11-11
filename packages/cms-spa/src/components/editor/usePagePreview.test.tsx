/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, jest, mock, spyOn, test } from 'bun:test';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RpcError } from '../../frame/channel.js';
import { configureUI, getUIConfig, type OpenPreviewResult, setPreviewCapability } from '../../ui-config.js';
import { Toaster, toast } from '../toast.js';
import { PageEditorHeaderActions } from './PageEditorHeaderActions.js';
import {
  PREVIEW_BLOCKED_TITLE,
  PREVIEW_CHECK_AGAIN,
  PREVIEW_FAILED_TITLE,
  PREVIEW_TRY_AGAIN,
  PREVIEW_UNAVAILABLE_DETAIL,
  PREVIEW_UNAVAILABLE_NEXT_STEP,
  PREVIEW_UNAVAILABLE_TITLE,
} from './preview-availability.js';
import { askHost, usePagePreview } from './usePagePreview.js';

// Sonner keeps its toasts in one process-wide store and replays the live ones into a Toaster that mounts later, so a
// toast of the previous test would satisfy (or hide) this one's assertions.
beforeEach(() => {
  toast.dismiss();
});

afterEach(() => {
  cleanup();
  configureUI({});
  toast.dismiss();
  // Sonner appends its section to document.body; clear it so one test's toast can't satisfy the next.
  document.body.innerHTML = '';
});

function PreviewControl({ pathname = '/about', withToaster = true }: { pathname?: string; withToaster?: boolean }) {
  const preview = usePagePreview(pathname);
  return (
    <>
      {withToaster ? <Toaster /> : null}
      <PageEditorHeaderActions
        onPreview={preview.open}
        previewDisabledReason={preview.blockedReason ?? undefined}
        previewPending={preview.pending}
        currentLocale="en"
        availableLocales={['en']}
        saveState="idle"
        isDirty={false}
        onSave={() => undefined}
        onOpenMetadata={() => undefined}
        onBack={() => undefined}
      />
    </>
  );
}

function previewTab() {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const tab = frame.contentWindow;
  if (tab === null) throw new Error('The test browser did not create a preview window.');
  let href = 'about:blank';
  Object.defineProperty(tab.location, 'href', {
    configurable: true,
    get: () => href,
    set: (address: string) => {
      href = address;
    },
  });
  // Happy DOM makes an iframe's opener read-only; a popup allows clearing it before navigation.
  Object.defineProperty(tab, 'opener', { configurable: true, writable: true, value: window });
  const close = spyOn(tab, 'close').mockImplementation(() => undefined);
  return { window: tab, close };
}

const NOT_DEPLOYED_MESSAGE = 'example.com does not serve draft preview.';
const UNAVAILABLE_PREVIEW_RESULT: OpenPreviewResult = {
  ok: false,
  reason: 'not-deployed',
  message: NOT_DEPLOYED_MESSAGE,
  previewCapability: 'unavailable',
};

function missingPreviewResponder(): never {
  throw new Error('The pending preview request has no responder.');
}

describe('usePagePreview', () => {
  test('a response from an editor that was left cannot disable its replacement', async () => {
    let reply: (result: OpenPreviewResult) => void = missingPreviewResponder;
    const pending = new Promise<OpenPreviewResult>((resolve) => {
      reply = resolve;
    });
    configureUI({ openPreview: () => pending, previewTab: 'parent' });
    const previous = render(<PreviewControl />);
    fireEvent.click(screen.getByTestId('preview-button'));
    previous.unmount();

    configureUI({
      openPreview: async () => ({ ok: true, url: 'https://preview.test/new' }),
      previewTab: 'parent',
      previewCapability: 'available',
    });
    render(<PreviewControl />);
    await act(async () => {
      reply(UNAVAILABLE_PREVIEW_RESULT);
      await pending;
    });

    expect(getUIConfig().previewCapability).toBe('available');
    expect(screen.getByTestId('preview-button').getAttribute('aria-disabled')).toBe('false');
  });

  test('a response from the previous host cannot disable the current host', async () => {
    let reply: (result: OpenPreviewResult) => void = missingPreviewResponder;
    const pending = new Promise<OpenPreviewResult>((resolve) => {
      reply = resolve;
    });
    configureUI({ openPreview: () => pending, previewTab: 'parent' });
    render(<PreviewControl />);
    fireEvent.click(screen.getByTestId('preview-button'));

    await act(async () => {
      configureUI({
        openPreview: async () => ({ ok: true, url: 'https://preview.test/new' }),
        previewTab: 'parent',
        previewCapability: 'available',
      });
      reply(UNAVAILABLE_PREVIEW_RESULT);
      await pending;
    });

    expect(getUIConfig().previewCapability).toBe('available');
    expect(screen.getByTestId('preview-button').getAttribute('aria-disabled')).toBe('false');
  });

  test('a rejected response from the previous host cannot report a failure over its replacement', async () => {
    const { promise: pending, reject } = Promise.withResolvers<OpenPreviewResult>();
    configureUI({ openPreview: () => pending, previewTab: 'parent' });
    const raised = spyOn(toast, 'error');
    const logged = spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(<PreviewControl withToaster={false} />);
      fireEvent.click(screen.getByTestId('preview-button'));
      await act(async () => {
        configureUI({
          openPreview: async () => ({ ok: true, url: 'https://preview.test/new' }),
          previewTab: 'parent',
          previewCapability: 'available',
        });
        reject(new Error('The previous host disconnected'));
        await pending.catch(() => undefined);
      });
      expect(raised).not.toHaveBeenCalled();
      expect(logged).not.toHaveBeenCalled();
      expect(getUIConfig().previewCapability).toBe('available');
    } finally {
      raised.mockRestore();
      logged.mockRestore();
    }
  });

  test('provider B can start before A settles and A cannot clear B pending state', async () => {
    const a = Promise.withResolvers<OpenPreviewResult>();
    const b = Promise.withResolvers<OpenPreviewResult>();
    const openA = mock(() => a.promise);
    const openB = mock(() => b.promise);
    configureUI({ openPreview: openA, previewTab: 'parent' });
    render(<PreviewControl />);
    fireEvent.click(screen.getByTestId('preview-button'));
    await act(async () => configureUI({ openPreview: openB, previewTab: 'parent' }));
    fireEvent.click(screen.getByTestId('preview-button'));
    expect(openB).toHaveBeenCalledTimes(1);
    await act(async () => {
      a.resolve(UNAVAILABLE_PREVIEW_RESULT);
      await a.promise;
    });
    expect(screen.getByTestId('preview-button').getAttribute('aria-busy')).toBe('true');
    fireEvent.click(screen.getByTestId('preview-button'));
    expect(openB).toHaveBeenCalledTimes(1);
    expect(getUIConfig().previewCapability).not.toBe('unavailable');
    await act(async () => {
      b.resolve({ ok: true, url: 'https://preview.test/b', previewCapability: 'available' });
      await b.promise;
    });
    expect(screen.getByTestId('preview-button').getAttribute('aria-busy')).toBe('false');
  });

  test.each([
    'A workspace admin can confirm the address in the editor banner or the setup checklist.',
    'Upgrade the preview server to protocol 2, then choose Check again.',
  ])('a remounted unavailable control uses neutral advice until the server explains: %s', async (message) => {
    const openPreview = mock(
      async (): Promise<OpenPreviewResult> => ({
        ok: false,
        reason: 'not-deployed',
        message,
        previewCapability: 'unavailable',
      }),
    );
    configureUI({ openPreview, previewTab: 'parent' });
    const first = render(<PreviewControl />);
    fireEvent.click(screen.getByTestId('preview-button'));
    await waitFor(() => expect(getUIConfig().previewCapability).toBe('unavailable'));
    first.unmount();
    render(<PreviewControl />);
    fireEvent.click(screen.getByTestId('preview-button'));
    expect(screen.getByTestId('preview-button').title).not.toContain('no preview server');
    expect(screen.queryByText('Set up a preview server', { exact: false })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: PREVIEW_CHECK_AGAIN }));
    await waitFor(() => expect(openPreview).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(message)).toBeTruthy();
  });

  test('a replaced provider cannot retain the previous provider refusal reason', async () => {
    const admin = 'A workspace admin must confirm the address.';
    const upgrade = 'Upgrade the preview server to protocol 2.';
    configureUI({
      previewTab: 'parent',
      openPreview: async () => ({ ok: false, reason: 'not-deployed', message: admin }),
    });
    render(<PreviewControl />);
    fireEvent.click(screen.getByTestId('preview-button'));
    expect(await screen.findByText(admin)).toBeTruthy();
    const replacement = mock(
      async (): Promise<OpenPreviewResult> => ({
        ok: false,
        reason: 'not-deployed',
        message: upgrade,
        previewCapability: 'unavailable',
      }),
    );
    const dismissed = spyOn(toast, 'dismiss');
    try {
      await act(async () =>
        configureUI({ previewTab: 'parent', previewCapability: 'unavailable', openPreview: replacement }),
      );
      expect(dismissed).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('preview-button').title).toBe(PREVIEW_UNAVAILABLE_DETAIL);
      fireEvent.click(screen.getByTestId('preview-button'));
      const explanation = await screen.findByText(`${PREVIEW_UNAVAILABLE_DETAIL} ${PREVIEW_UNAVAILABLE_NEXT_STEP}`);
      // Sonner schedules dismissal asynchronously; target the current provider's explanation.
      const currentToast = explanation.closest('[data-sonner-toast]');
      if (!(currentToast instanceof HTMLElement)) throw new Error('The current refusal has no toast');
      fireEvent.click(within(currentToast).getByRole('button', { name: PREVIEW_CHECK_AGAIN }));
      expect(await screen.findByText(upgrade)).toBeTruthy();
      expect(replacement).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('preview-button').title).toBe(upgrade);
    } finally {
      dismissed.mockRestore();
    }
  });

  test('an A to B to A transition cannot restore ownership to the first A request', async () => {
    const oldA = Promise.withResolvers<OpenPreviewResult>();
    const b = Promise.withResolvers<OpenPreviewResult>();
    const newA = Promise.withResolvers<OpenPreviewResult>();
    let calls = 0;
    const providerA = mock(() => (++calls === 1 ? oldA.promise : newA.promise));
    const providerB = mock(() => b.promise);
    configureUI({ openPreview: providerA, previewTab: 'parent' });
    render(<PreviewControl />);
    fireEvent.click(screen.getByTestId('preview-button'));
    await act(async () => configureUI({ openPreview: providerB, previewTab: 'parent' }));
    fireEvent.click(screen.getByTestId('preview-button'));
    await act(async () => configureUI({ openPreview: providerA, previewTab: 'parent' }));
    fireEvent.click(screen.getByTestId('preview-button'));
    expect(providerA).toHaveBeenCalledTimes(2);
    await act(async () => {
      oldA.resolve(UNAVAILABLE_PREVIEW_RESULT);
      b.resolve(UNAVAILABLE_PREVIEW_RESULT);
      await Promise.all([oldA.promise, b.promise]);
    });
    expect(getUIConfig().previewCapability).not.toBe('unavailable');
    expect(screen.getByTestId('preview-button').getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      newA.resolve({ ok: true, url: 'https://preview.test/current', previewCapability: 'available' });
      await newA.promise;
    });
    expect(getUIConfig().previewCapability).toBe('available');
  });

  test.each(['parent', 'editor'] as const)(
    'the old provider timeout cannot finish the current %s request',
    async (owner) => {
      jest.useFakeTimers();
      const a = Promise.withResolvers<OpenPreviewResult>();
      const b = Promise.withResolvers<OpenPreviewResult>();
      const tabA = previewTab();
      const tabB = previewTab();
      const popup = spyOn(window, 'open').mockReturnValueOnce(tabA.window).mockReturnValueOnce(tabB.window);
      const raised = spyOn(toast, 'error');
      try {
        configureUI({ openPreview: () => a.promise, previewTab: owner === 'parent' ? 'parent' : undefined });
        render(<PreviewControl withToaster={false} />);
        fireEvent.click(screen.getByTestId('preview-button'));
        await act(async () => jest.advanceTimersByTime(10_000));
        const openB = mock(() => b.promise);
        await act(async () =>
          configureUI({ openPreview: openB, previewTab: owner === 'parent' ? 'parent' : undefined }),
        );
        fireEvent.click(screen.getByTestId('preview-button'));
        expect(openB).toHaveBeenCalledTimes(1);
        await act(async () => jest.advanceTimersByTime(20_001));
        expect(screen.getByTestId('preview-button').getAttribute('aria-busy')).toBe('true');
        expect(tabB.close).not.toHaveBeenCalled();
        expect(raised).not.toHaveBeenCalled();
        await act(async () => {
          b.resolve({ ok: true, url: 'https://preview.test/b', previewCapability: 'available' });
          await b.promise;
          a.resolve(UNAVAILABLE_PREVIEW_RESULT);
          await a.promise;
        });
        expect(getUIConfig().previewCapability).toBe('available');
        if (owner === 'parent') expect(popup).not.toHaveBeenCalled();
        else expect(tabB.window.location.href).toBe('https://preview.test/b');
      } finally {
        popup.mockRestore();
        raised.mockRestore();
        jest.useRealTimers();
      }
    },
  );

  test.each([{}, { previewCapability: undefined }, { previewCapability: 'unknown' as const }])(
    'an unconfirmed minted URL cannot erase a definitive unavailable verdict: %j',
    async (proof) => {
      const result = {
        ok: true as const,
        url: 'https://preview.test/unconfirmed',
        ...proof,
      };
      configureUI({ openPreview: async () => result, previewTab: 'parent', previewCapability: 'unavailable' });
      render(<PreviewControl />);
      fireEvent.click(screen.getByTestId('preview-button'));
      fireEvent.click(await screen.findByRole('button', { name: PREVIEW_CHECK_AGAIN }));
      await waitFor(() => expect(screen.getByTestId('preview-button').getAttribute('aria-busy')).toBe('false'));
      expect(getUIConfig().previewCapability).toBe('unavailable');
      expect(screen.getByTestId('preview-button').getAttribute('aria-disabled')).toBe('true');
    },
  );

  test.each([{}, { previewCapability: undefined }, { previewCapability: 'unknown' as const }])(
    'an inconclusive refusal explains the request without disabling a working preview: %j',
    async (proof) => {
      const message = 'A workspace admin can confirm this address.';
      const result = { ok: false as const, reason: 'not-deployed' as const, message, ...proof };
      configureUI({ openPreview: async () => result, previewTab: 'parent', previewCapability: 'available' });
      render(<PreviewControl />);
      fireEvent.click(screen.getByTestId('preview-button'));
      await waitFor(() => expect(screen.getByTestId('preview-button').getAttribute('aria-busy')).toBe('false'));
      expect(getUIConfig().previewCapability).toBe('available');
      expect(screen.getByTestId('preview-button').getAttribute('aria-disabled')).toBe('false');
      expect(await screen.findByText(message)).toBeTruthy();
    },
  );

  test('the frame tab cooldown preserves the setup explanation instead of reporting a preview fault', async () => {
    configureUI({
      openPreview: async () => {
        throw new RpcError('Too many tabs opened', 'rate_limited');
      },
      previewTab: 'parent',
      previewCapability: 'unavailable',
    });
    const logged = spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(<PreviewControl />);
      fireEvent.click(screen.getByTestId('preview-button'));
      fireEvent.click(await screen.findByRole('button', { name: PREVIEW_CHECK_AGAIN }));
      await waitFor(() => expect(screen.getByTestId('preview-button').getAttribute('aria-busy')).toBe('false'));
      expect(screen.queryByText(PREVIEW_FAILED_TITLE)).toBeNull();
      expect(await screen.findByText(PREVIEW_UNAVAILABLE_TITLE)).toBeTruthy();
      expect(screen.getByRole('button', { name: PREVIEW_CHECK_AGAIN })).toBeTruthy();
      expect(getUIConfig().previewCapability).toBe('unavailable');
    } finally {
      logged.mockRestore();
    }
  });

  test.each(['blocked', 'failed'] as const)(
    'an inconclusive parent retry preserves the unavailable verdict: %s',
    async (outcome) => {
      const openPreview = mock(async (): Promise<OpenPreviewResult | { ok: false; reason: 'popup-blocked' }> => {
        if (outcome === 'failed') throw new Error('The host connection failed.');
        return { ok: false, reason: 'popup-blocked' };
      });
      const logged = spyOn(console, 'error').mockImplementation(() => undefined);
      configureUI({ openPreview, previewTab: 'parent', previewCapability: 'unavailable' });
      try {
        render(<PreviewControl />);
        fireEvent.click(screen.getByTestId('preview-button'));
        fireEvent.click(await screen.findByRole('button', { name: PREVIEW_CHECK_AGAIN }));
        await waitFor(() => expect(openPreview).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getByTestId('preview-button').getAttribute('aria-busy')).toBe('false'));
        expect(getUIConfig().previewCapability).toBe('unavailable');
        expect(screen.getByTestId('preview-button').getAttribute('aria-disabled')).toBe('true');
      } finally {
        logged.mockRestore();
      }
    },
  );

  test('unmounting dismisses the current explanation rather than every historical toast', () => {
    configureUI({
      openPreview: async () => UNAVAILABLE_PREVIEW_RESULT,
      previewTab: 'parent',
      previewCapability: 'unavailable',
    });
    const dismissed = spyOn(toast, 'dismiss');
    try {
      const view = render(<PreviewControl withToaster={false} />);
      for (let index = 0; index < 25; index += 1) fireEvent.click(screen.getByTestId('preview-button'));
      const beforeUnmount = dismissed.mock.calls.length;
      view.unmount();
      expect(dismissed.mock.calls.length - beforeUnmount).toBe(1);
    } finally {
      dismissed.mockRestore();
    }
  });

  test('re-enables Preview when the host later reports that the site can preview', () => {
    configureUI({
      openPreview: async () => ({ ok: true, url: 'https://preview.test/' }),
      previewCapability: 'unavailable',
    });
    render(<PreviewControl />);
    const button = screen.getByTestId('preview-button');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('title')).toBe(PREVIEW_UNAVAILABLE_DETAIL);

    act(() => setPreviewCapability('available'));

    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Preview');
  });

  test('disables Preview when the host learns, after the editor opened, that the site cannot preview', () => {
    configureUI({ openPreview: async () => ({ ok: true, url: 'https://preview.test/' }) });
    render(<PreviewControl />);
    const button = screen.getByTestId('preview-button');
    expect(button.getAttribute('aria-disabled')).toBe('false');

    act(() => setPreviewCapability('unavailable'));

    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  test('preserves the admin confirmation next step without prescribing a preview server', async () => {
    const message = 'A workspace admin can confirm the address in the editor banner or the setup checklist.';
    configureUI({ previewTab: 'parent', openPreview: async () => ({ ok: false, reason: 'not-deployed', message }) });
    render(<PreviewControl />);
    fireEvent.click(screen.getByTestId('preview-button'));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText(PREVIEW_UNAVAILABLE_NEXT_STEP, { exact: false })).toBeNull();
    expect(screen.getByRole('button', { name: PREVIEW_CHECK_AGAIN })).toBeTruthy();
  });

  test('explains a support-session restriction without offering a futile retry or changing the site verdict', async () => {
    const message = 'Preview is not available in a support session.';
    const openPreview = mock(
      async (): Promise<OpenPreviewResult> => ({
        ok: false,
        reason: 'not-allowed',
        message,
        previewCapability: 'unknown',
      }),
    );
    configureUI({ openPreview, previewTab: 'parent', previewCapability: 'unknown' });
    const open = spyOn(window, 'open').mockImplementation(() => null);
    try {
      render(<PreviewControl />);
      const button = screen.getByTestId('preview-button');
      fireEvent.click(button);

      expect(await screen.findByText(message)).toBeTruthy();
      await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
      expect(screen.queryByRole('button', { name: PREVIEW_CHECK_AGAIN })).toBeNull();
      expect(screen.queryByRole('button', { name: PREVIEW_TRY_AGAIN })).toBeNull();
      expect(screen.queryByText(PREVIEW_UNAVAILABLE_TITLE)).toBeNull();
      expect(button.getAttribute('aria-disabled')).toBe('false');
      expect(getUIConfig().previewCapability).toBe('unknown');
      expect(openPreview).toHaveBeenCalledTimes(1);
      expect(open).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });

  test('a not-deployed answer says why, what to do next and offers Check again, which asks the site again', async () => {
    const answers: OpenPreviewResult[] = [
      UNAVAILABLE_PREVIEW_RESULT,
      { ok: true, url: 'https://preview.test/about', previewCapability: 'available' },
    ];
    const openPreview = mock(async () => answers.shift() ?? UNAVAILABLE_PREVIEW_RESULT);
    configureUI({ openPreview });
    const tabs = [previewTab(), previewTab()];
    const open = spyOn(window, 'open').mockImplementation(() => tabs.shift()?.window ?? null);
    try {
      render(<PreviewControl />);
      const button = screen.getByTestId('preview-button');
      fireEvent.click(button);

      expect(await screen.findByText(PREVIEW_UNAVAILABLE_TITLE)).toBeTruthy();
      expect(await screen.findByText(NOT_DEPLOYED_MESSAGE)).toBeTruthy();
      await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));
      expect(openPreview).toHaveBeenCalledTimes(1);

      fireEvent.click(await screen.findByRole('button', { name: PREVIEW_CHECK_AGAIN }));

      await waitFor(() => expect(openPreview).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'));
      expect(open).toHaveBeenCalledTimes(2);
    } finally {
      open.mockRestore();
    }
  });

  test('a second click on the already-known unavailable control explains without opening a tab', async () => {
    const openPreview = mock(async (): Promise<OpenPreviewResult> => UNAVAILABLE_PREVIEW_RESULT);
    configureUI({ openPreview, previewCapability: 'unavailable' });
    const open = spyOn(window, 'open').mockImplementation(() => null);
    try {
      render(<PreviewControl />);
      fireEvent.click(screen.getByTestId('preview-button'));

      expect(await screen.findByText(PREVIEW_UNAVAILABLE_TITLE)).toBeTruthy();
      expect(screen.getByRole('button', { name: PREVIEW_CHECK_AGAIN })).toBeTruthy();
      expect(open).not.toHaveBeenCalled();
      expect(openPreview).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });

  test('shows the request in flight and ignores clicks until it settles', async () => {
    let settle!: (result: OpenPreviewResult) => void;
    const openPreview = mock(
      () =>
        new Promise<OpenPreviewResult>((resolve) => {
          settle = resolve;
        }),
    );
    configureUI({ openPreview });
    const tab = previewTab();
    const open = spyOn(window, 'open').mockImplementation(() => tab.window);
    try {
      render(<PreviewControl />);
      const button = screen.getByTestId('preview-button');
      expect(button.getAttribute('aria-busy')).toBe('false');

      fireEvent.click(button);
      await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
      fireEvent.click(button);
      expect(openPreview).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledTimes(1);

      await act(async () => settle({ ok: true, url: 'https://preview.test/about' }));

      await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
      expect(tab.window.location.href).toBe('https://preview.test/about');
    } finally {
      open.mockRestore();
    }
  });

  test('a browser-blocked tab is explained with the next step instead of being swallowed', async () => {
    const openPreview = mock(async (): Promise<OpenPreviewResult> => ({ ok: true, url: 'https://preview.test/' }));
    configureUI({ openPreview });
    const open = spyOn(window, 'open').mockImplementation(() => null);
    try {
      render(<PreviewControl />);
      fireEvent.click(screen.getByTestId('preview-button'));

      expect(await screen.findByText(PREVIEW_BLOCKED_TITLE)).toBeTruthy();
      expect(screen.getByRole('button', { name: PREVIEW_TRY_AGAIN })).toBeTruthy();
      expect(openPreview).not.toHaveBeenCalled();
      expect(screen.getByTestId('preview-button').getAttribute('aria-disabled')).toBe('false');
    } finally {
      open.mockRestore();
    }
  });

  test('a genuine fault offers Try again and never disables the control', async () => {
    const openPreview = mock(async (): Promise<OpenPreviewResult> => {
      throw new Error('preview failed');
    });
    configureUI({ openPreview });
    const tab = previewTab();
    const open = spyOn(window, 'open').mockImplementation(() => tab.window);
    const logged = spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(<PreviewControl />);
      const button = screen.getByTestId('preview-button');
      fireEvent.click(button);

      expect(await screen.findByText(PREVIEW_FAILED_TITLE)).toBeTruthy();
      expect(screen.getByRole('button', { name: PREVIEW_TRY_AGAIN })).toBeTruthy();
      expect(tab.close).toHaveBeenCalledTimes(1);
      expect(button.getAttribute('aria-disabled')).toBe('false');
    } finally {
      open.mockRestore();
      logged.mockRestore();
    }
  });

  test.each(['editor', 'parent'] as const)(
    'an openPreview that throws before answering (%s-owned tab) is reported and does not strand the control',
    async (previewTabOwner) => {
      const openPreview = mock((): Promise<OpenPreviewResult> => {
        throw new Error('host is gone');
      });
      configureUI({ openPreview, previewTab: previewTabOwner });
      const tab = previewTab();
      const open = spyOn(window, 'open').mockImplementation(() => tab.window);
      const logged = spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        render(<PreviewControl />);
        const button = screen.getByTestId('preview-button');
        fireEvent.click(button);

        expect(await screen.findByText(PREVIEW_FAILED_TITLE)).toBeTruthy();
        await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
        fireEvent.click(button);
        await waitFor(() => expect(openPreview).toHaveBeenCalledTimes(2));
      } finally {
        open.mockRestore();
        logged.mockRestore();
      }
    },
  );

  test('a host that never answers is given up on, so the control is not left working forever', async () => {
    const never = mock(() => new Promise<OpenPreviewResult>(() => undefined));
    await expect(askHost(never, '/about', 5)).rejects.toThrow('did not answer the preview request within 5 ms');
    const answers = mock(async (): Promise<OpenPreviewResult> => ({ ok: true, url: 'https://preview.test/' }));
    expect(await askHost(answers, '/about', 5)).toEqual({ ok: true, url: 'https://preview.test/' });
    expect(answers).toHaveBeenCalledWith({ path: '/about' });
  });

  test('Check again with the browser still blocking the tab leaves the verdict as it was', async () => {
    const openPreview = mock(async (): Promise<OpenPreviewResult> => UNAVAILABLE_PREVIEW_RESULT);
    configureUI({ openPreview, previewCapability: 'unavailable' });
    const open = spyOn(window, 'open').mockImplementation(() => null);
    try {
      render(<PreviewControl />);
      const button = screen.getByTestId('preview-button');
      fireEvent.click(button);
      fireEvent.click(await screen.findByRole('button', { name: PREVIEW_CHECK_AGAIN }));

      expect(await screen.findByText(PREVIEW_BLOCKED_TITLE)).toBeTruthy();
      expect(openPreview).not.toHaveBeenCalled();
      expect(getUIConfig().previewCapability).toBe('unavailable');
      expect(button.getAttribute('aria-disabled')).toBe('true');
    } finally {
      open.mockRestore();
    }
  });

  test('Try again after a fault never rewrites what the host knows about the site', async () => {
    const openPreview = mock(async (): Promise<OpenPreviewResult> => {
      throw new Error('preview failed');
    });
    configureUI({ openPreview, previewCapability: 'available' });
    const open = spyOn(window, 'open').mockImplementation(() => previewTab().window);
    const logged = spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(<PreviewControl />);
      fireEvent.click(screen.getByTestId('preview-button'));
      fireEvent.click(await screen.findByRole('button', { name: PREVIEW_TRY_AGAIN }));

      await waitFor(() => expect(openPreview).toHaveBeenCalledTimes(2));
      expect(getUIConfig().previewCapability).toBe('available');
    } finally {
      open.mockRestore();
      logged.mockRestore();
    }
  });

  test('a preview that opens overrides a verdict of unavailable that arrived while it was in flight', async () => {
    let settle!: (result: OpenPreviewResult) => void;
    const openPreview = mock(
      () =>
        new Promise<OpenPreviewResult>((resolve) => {
          settle = resolve;
        }),
    );
    configureUI({ openPreview, previewTab: 'parent' });
    render(<PreviewControl />);
    const button = screen.getByTestId('preview-button');
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));

    act(() => setPreviewCapability('unavailable'));
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await act(async () => settle({ ok: true, url: 'https://preview.test/about', previewCapability: 'available' }));

    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'));
    expect(getUIConfig().previewCapability).toBe('available');
  });

  test('its toasts are dismissed with the editor, so no action can open the preview of a page that is no longer open', async () => {
    // Sonner removes a dismissed toast on an animation frame, which happy-dom never delivers; the dismissal itself is
    // what the hook owns (the story "Preview Toasts Go With The Editor" checks the removal in a real browser).
    const openPreview = mock(async (): Promise<OpenPreviewResult> => UNAVAILABLE_PREVIEW_RESULT);
    configureUI({ openPreview, previewCapability: 'unavailable' });
    const view = render(<PreviewControl />);
    fireEvent.click(screen.getByTestId('preview-button'));
    expect(await screen.findByText(PREVIEW_UNAVAILABLE_TITLE)).toBeTruthy();

    const dismiss = spyOn(toast, 'dismiss');
    try {
      view.unmount();

      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(dismiss.mock.calls[0]?.[0]).toBeDefined();
      expect(openPreview).not.toHaveBeenCalled();
    } finally {
      dismiss.mockRestore();
    }
  });
});
