/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Toaster as SonnerToaster } from 'sonner';
import { Toaster, type ToasterProps, toast } from '../src/components/toast';

afterEach(() => {
  cleanup();
  // Sonner appends a section to document.body; reset between tests so the
  // previous render's section doesn't leak into the next test's queries.
  document.body.innerHTML = '';
});

describe('toast wrapper', () => {
  describe('Toaster surface', () => {
    test('renders a polite aria-live region so screen readers announce toasts', () => {
      render(<Toaster />);
      const section = document.querySelector('section[aria-live="polite"]');
      expect(section).toBeTruthy();
    });

    test('passes the cms-spa defaults (position, theme, richColors) to sonner', () => {
      // Sonner's own position fallback is also bottom-right, so a rendered-DOM
      // assertion would pass even with our default deleted. Inspect the element
      // the wrapper builds instead — that observes our code, not sonner's fallback.
      const element = Toaster({}) as ReactElement<ToasterProps>;
      expect(element.type).toBe(SonnerToaster);
      expect(element.props.position).toBe('bottom-right');
      expect(element.props.theme).toBe('system');
      expect(element.props.richColors).toBe(false);
    });

    test('lets consumers override the position default', async () => {
      render(<Toaster position="top-left" />);
      toast('top left, please');
      await waitFor(() => {
        const list = document.querySelector('ol[data-sonner-toaster]');
        expect(list).toBeTruthy();
        expect((list as HTMLElement).dataset.yPosition).toBe('top');
        expect((list as HTMLElement).dataset.xPosition).toBe('left');
      });
    });

    test('forwards consumer className onto the ol so cms-spa overrides win', async () => {
      render(<Toaster className="cms-toaster-test-anchor" />);
      toast('class anchor');
      await waitFor(() => {
        const list = document.querySelector('ol[data-sonner-toaster]');
        expect(list).toBeTruthy();
        expect((list as HTMLElement).className).toContain('cms-toaster-test-anchor');
      });
    });
  });

  describe('toast lifecycle', () => {
    test('renders toast.success content inside the toaster', async () => {
      render(<Toaster />);
      toast.success('Saved');
      await waitFor(() => {
        const liveToast = document.querySelector('[data-sonner-toast]');
        expect(liveToast).toBeTruthy();
        expect((liveToast as HTMLElement).textContent ?? '').toContain('Saved');
      });
    });

    test('renders toast.error content inside the toaster', async () => {
      render(<Toaster />);
      toast.error('Something broke');
      await waitFor(() => {
        const liveToast = document.querySelector('[data-sonner-toast]');
        expect(liveToast).toBeTruthy();
        expect((liveToast as HTMLElement).textContent ?? '').toContain('Something broke');
      });
    });
  });
});
