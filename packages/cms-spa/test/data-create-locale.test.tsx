/// <reference lib="dom" />
/**
 * The language a new data entry is created in.
 *
 * A page reads the data entries of its own language only, so an entry the data list created in
 * English on a site with no English never reached a page: it has to be created in the language
 * the editor offers first, as new pages and fragments are.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { z } from 'zod';
import { DataList } from '../src/components/pages/DataList.js';
import { configureUI } from '../src/ui-config.js';
import { renderWithProviders, setupTestAPI, testApi } from './test-utils.js';

const dataSchemas = { authors: z.object({ bio: z.string().optional() }) };

afterEach(() => {
  cleanup();
  testApi?.clear();
});

describe('a new data entry on a site whose only language is German', () => {
  test('is created in German and opens in German', async () => {
    setupTestAPI('/__cms/api', { sites: { default: { locales: ['de'], defaultLocale: 'de' } }, globalLocales: ['de'] });
    configureUI({ apiBaseUrl: '/__cms/api', locales: { list: ['de'], defaultLocale: 'de' } });

    renderWithProviders(<DataList dataSchemas={dataSchemas} />, {}, false);
    fireEvent.click(await screen.findByTestId('new-data-button'));
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Anna Schmidt' } });
    fireEvent.click(screen.getByTestId('create-data-submit'));

    const editor = await screen.findByTestId('edit-data-dialog');
    expect(editor.textContent).toContain('authors · de');
    const [entry] = Array.from(testApi.listAllContent({ kind: 'data', collection: 'authors' }));
    expect(Object.keys(entry?.locales ?? {})).toEqual(['de']);
    expect(entry?.locales.de?.meta?.title).toBe('Anna Schmidt');
  });
});
