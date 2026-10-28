/// <reference lib="dom" />
import { afterEach, expect, spyOn, test } from 'bun:test';
import { cleanup, waitFor } from '@testing-library/react';
import * as app from '../src/App.js';
import { toast } from '../src/components/toast.js';
import { mountSpa } from '../src/main-spa.js';
import { configureUI } from '../src/ui-config.js';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

// The local editor (astro-cms's /__cms route) boots through mountSpa; nothing above it renders toasts.
test('the local editor renders the toasts the editor raises', async () => {
  const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  const appSpy = spyOn(app, 'default').mockImplementation(() => {
    toast.error('Preview is not available for this branch');
    return <></>;
  });
  try {
    configureUI({ basename: '/__cms', apiBaseUrl: '/__cms/api' });
    document.body.innerHTML = '<div id="root"></div>';
    mountSpa();
    await waitFor(() => expect(document.body.textContent).toContain('Preview is not available for this branch'));
  } finally {
    appSpy.mockRestore();
    fetchSpy.mockRestore();
  }
});
