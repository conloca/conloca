/// <reference lib="dom" />
/**
 * A site whose `dataSchemas` entry is not a generated host schema.
 *
 * The editor receives `dataSchemas` from the site's own bundle at runtime, so what arrives can
 * be an entry written before the generated-contract format (a validator-library object with no
 * `metadata`). Saving a new entry opens the data editor on that entry, and the form used to
 * throw "Cannot read properties of undefined (reading 'schema')", which unmounted the whole CMS.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SchemaForm } from '../src/components/forms/SchemaForm.js';
import { DataList } from '../src/components/pages/DataList.js';
import type { HostSchema } from '../src/host-schema.js';
import { configureUI } from '../src/ui-config.js';
import { bioFields } from './fixtures/typia/host-schemas.js';
import { renderWithProviders, setupTestAPI, testApi } from './test-utils.js';

/** What a site's bundle can export under a schema name: members of a generated schema, or none of them. */
interface BundleExport {
  parse?: () => object;
  shape?: object;
  validate?: HostSchema['validate'];
  metadata?: object;
}

/**
 * A bundle export typed as the `HostSchema` the editor declares. A bundle is untyped at runtime,
 * so the fixtures below model values the type forbids on purpose.
 */
function bundleSchema(exported: BundleExport): HostSchema {
  // SAFETY: deliberately false, the tests feed the editor what a stale site bundle can export.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same reason as the SAFETY note.
  return exported as HostSchema;
}

/** What a site bundle built before the generated contract exports: a parser with a `shape`, no `metadata`. */
const outdatedSchema = bundleSchema({ parse: () => ({}), shape: { name: { type: 'string' } } });

afterEach(() => {
  cleanup();
  testApi?.clear();
});

describe('saving a new data entry on a site whose schema is not a generated host schema', () => {
  test('keeps the editor open and says the schema needs regenerating', async () => {
    setupTestAPI('/__cms/api', { sites: { default: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] });
    configureUI({ apiBaseUrl: '/__cms/api', locales: { list: ['en'], defaultLocale: 'en' } });

    renderWithProviders(<DataList dataSchemas={{ authors: outdatedSchema }} />, {}, false);
    fireEvent.click(await screen.findByTestId('new-data-button'));
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Anna Schmidt' } });
    fireEvent.click(screen.getByTestId('create-data-submit'));

    const editor = await screen.findByTestId('edit-data-dialog');
    const notice = await within(editor).findByTestId('schema-form-outdated-schema');
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.textContent).toContain('not a generated host schema');
    expect(Array.from(testApi.listAllContent({ kind: 'data', collection: 'authors' }))).toHaveLength(1);
  });
});

describe('SchemaForm given a schema that is not a generated host schema', () => {
  test.each([
    ['has no metadata', outdatedSchema],
    ['has empty metadata', bundleSchema({ validate: bioFields.validate, metadata: {} })],
  ])('renders the notice instead of throwing when the schema %s', (_name, schema) => {
    render(<SchemaForm schema={schema} values={{}} onChange={() => {}} />);

    expect(screen.getByTestId('schema-form-outdated-schema')).toBeTruthy();
  });
});
