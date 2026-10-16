import { describe, expect, it } from 'bun:test';
import {
  dataEditableFields,
  fragmentEditableFields,
  pathnameOnlyFields,
  publishWindowFields,
  seoPublishingFields,
} from '../src/content-form-fields.js';
import { type FieldInfo, type FormFields, fieldsOfMetadata } from '../src/utils/schema-fields.js';
import { dataEditableMetadata, fragmentEditableMetadata, pageEditableMetadata } from './fixtures/typia/host-schemas.js';

/**
 * Regression suite for the CMS's own form definitions.
 *
 * Each record in `src/content-form-fields.ts` replaces a Zod object that
 * existed only to be introspected into a form. The table below is what the
 * editor rendered from those objects, recorded literally — help text, the URL
 * input for `canonical`, and each field's optionality.
 */
const requiredString = (description: string): FieldInfo => ({
  type: 'string',
  description,
  isOptional: false,
  isNullable: false,
});
const optionalString = (description: string): FieldInfo => ({
  type: 'string',
  description,
  isOptional: true,
  isNullable: false,
});
const optionalArray = (description: string): FieldInfo => ({
  type: 'array',
  description,
  isOptional: true,
  isNullable: false,
});
const optionalNullableDate = (description: string): FieldInfo => ({
  type: 'date',
  format: 'date-time',
  description,
  isOptional: true,
  isNullable: true,
});

const publishWindow = {
  publishAt: optionalNullableDate(
    'When the page goes live. Page lists that sort by date use this date, or the date the page was created when it is empty.',
  ),
  unpublishAt: optionalNullableDate('Schedule unpublish date/time'),
};

const recorded: Record<string, [FormFields, FormFields]> = {
  pathnameOnlyFields: [pathnameOnlyFields, { pathname: requiredString('URL path (e.g., /about)') }],
  seoPublishingFields: [
    seoPublishingFields,
    {
      description: optionalString('Meta description for search engines'),
      robots: optionalString('Robots meta tag (e.g., index, follow)'),
      canonical: { ...optionalString('Canonical URL for duplicate content'), format: 'url' },
      ...publishWindow,
    },
  ],
  publishWindowFields: [publishWindowFields, publishWindow],
  fragmentEditableFields: [
    fragmentEditableFields,
    {
      title: requiredString('Display name for the fragment'),
      description: optionalString('Brief description of this fragment'),
      category: optionalString('Category for organizing fragments (e.g., headers, cta, content)'),
      tags: optionalArray('Tags for filtering and organization'),
    },
  ],
  dataEditableFields: [
    dataEditableFields,
    {
      title: requiredString('Display name for the entry'),
      description: optionalString('Brief description of this entry'),
      category: optionalString('Category for organizing entries'),
      tags: optionalArray('Tags for filtering and organization'),
    },
  ],
};

describe('content form fields render the recorded editor fields', () => {
  for (const [name, [actual, expected]] of Object.entries(recorded)) {
    it(name, () => {
      expect(actual).toEqual(expected);
      expect(Object.keys(actual)).toEqual(Object.keys(expected));
    });
  }
});

/**
 * The records must also agree with the content-api types they describe. The
 * metadata here is `typia.json.schema<T>()` output for `PageEditable`,
 * `FragmentEditable` and `DataEditable`, so renaming a field, changing its
 * type, or flipping its optionality in content-api fails this suite.
 */
describe('content form fields agree with the generated content-api metadata', () => {
  const shapeOf = (fields: FormFields) =>
    Object.fromEntries(
      Object.entries(fields).map(([name, info]) => [
        name,
        { type: info.type, isOptional: info.isOptional, isNullable: info.isNullable },
      ]),
    );
  const generated = (metadata: Parameters<typeof fieldsOfMetadata>[0]) => shapeOf(fieldsOfMetadata(metadata));

  it('every page form section is a slice of PageEditable', () => {
    const page = generated(pageEditableMetadata);
    for (const section of [pathnameOnlyFields, seoPublishingFields, publishWindowFields]) {
      for (const [name, field] of Object.entries(shapeOf(section))) {
        expect({ name, field }).toEqual({ name, field: page[name] });
      }
    }
  });

  it('fragment and data records cover exactly their editable types', () => {
    expect(shapeOf(fragmentEditableFields)).toEqual(generated(fragmentEditableMetadata));
    expect(shapeOf(dataEditableFields)).toEqual(generated(dataEditableMetadata));
  });
});
