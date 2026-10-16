import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import { defineHostSchema, hostSchemaFieldNames } from '../src/host-schema.js';
import { definePageSchema, toPageSchemaDescriptor } from '../src/page-schema-define.js';
import { fieldsOfHostSchema } from '../src/utils/schema-fields.js';
import { articleFields, profileFields, publishedAtFields, starlightFields } from './fixtures/typia/host-schemas.js';

/**
 * Host schemas are generated validators + generated metadata. Everything below
 * runs compiler output from `test/fixtures/typia/host-schemas.ts`; the form
 * the editor renders is read from the metadata alone.
 */
describe('fieldsOfHostSchema — the form a generated host schema renders as', () => {
  it('maps every control-relevant JSON Schema shape to the FieldInfo the form switches on', () => {
    expect(fieldsOfHostSchema(profileFields)).toEqual({
      heroImage: { type: 'string', isOptional: true, isNullable: false },
      featured: { type: 'boolean', isOptional: false, isNullable: false },
      order: { type: 'number', isOptional: true, isNullable: false },
      audience: { type: 'enum', enumValues: ['dev', 'ops'], isOptional: false, isNullable: false },
      readingTime: { type: 'number', isOptional: false, isNullable: true },
      relatedSlugs: { type: 'array', isOptional: true, isNullable: false },
      reviewedAt: { type: 'date', format: 'date-time', isOptional: true, isNullable: false },
      contact: { type: 'string', format: 'email', isOptional: true, isNullable: false },
      homepage: { type: 'string', format: 'url', isOptional: true, isNullable: false },
      rating: { type: 'number', isOptional: true, isNullable: false },
      badge: { type: 'string', isOptional: true, isNullable: false },
    });
  });

  it('carries JSDoc descriptions and max lengths from the generated metadata', () => {
    expect(fieldsOfHostSchema(articleFields).author).toEqual({
      type: 'string',
      description: 'Byline shown on cards',
      isOptional: true,
      isNullable: false,
    });
    expect(fieldsOfHostSchema(articleFields).excerpt).toEqual({
      type: 'string',
      maxLength: 300,
      isOptional: true,
      isNullable: false,
    });
    expect(fieldsOfHostSchema(publishedAtFields).publishedAt).toEqual({
      type: 'date',
      format: 'date-time',
      description: 'When this goes live',
      isOptional: true,
      isNullable: false,
    });
  });

  it('falls back to a text input for a union with no single control', () => {
    expect(fieldsOfHostSchema(starlightFields).editUrl).toEqual({
      type: 'string',
      isOptional: true,
      isNullable: false,
    });
  });

  it('keeps declaration order and hands out the same record every call', () => {
    expect(Object.keys(fieldsOfHostSchema(articleFields))).toEqual([
      'author',
      'date',
      'excerpt',
      'featuredImage',
      'tags',
    ]);
    expect(fieldsOfHostSchema(articleFields)).toBe(fieldsOfHostSchema(articleFields));
  });
});

describe('the generated validators a host schema carries', () => {
  it('accept a conforming entry and report a wrong field at its path', () => {
    expect(articleFields.validate({ author: 'Ada', tags: ['a'] }).success).toBe(true);
    const failure = articleFields.validate({ tags: 'not-an-array' });
    expect(failure.success).toBe(false);
    expect(failure.success === false && failure.errors.map((error) => error.path)).toEqual(['$input.tags']);
  });

  it('enforce generated constraints (MaxLength, Format, literal unions)', () => {
    expect(articleFields.validate({ excerpt: 'x'.repeat(301) }).success).toBe(false);
    expect(starlightFields.validate({ title: 'T', editUrl: 'not a url' }).success).toBe(false);
    expect(starlightFields.validate({ title: 'T', editUrl: false }).success).toBe(true);
    expect(starlightFields.validate({ title: 'T', template: 'landing' }).success).toBe(false);
  });

  it('a prune validator strips undeclared nested keys, the z.object() default', () => {
    const entry = { title: 'T', sidebar: { label: 'L', stray: 1 } };
    const result = starlightFields.validate(entry);
    expect(result.success && result.data.sidebar).toEqual({ label: 'L' });
  });

  it('accepts every entry built from the declared field types (property)', () => {
    fc.assert(
      fc.property(
        fc.record(
          { author: fc.string(), date: fc.string(), featuredImage: fc.string(), tags: fc.array(fc.string()) },
          { requiredKeys: [] },
        ),
        (entry) => {
          expect(articleFields.validate(entry).success).toBe(true);
        },
      ),
    );
  });
});

describe('defineHostSchema / definePageSchema declaration guards', () => {
  it('refuses metadata generated for a non-object type', () => {
    expect(() =>
      defineHostSchema({
        validate: articleFields.validate,
        metadata: { version: '3.1', components: {}, schema: { type: 'string' } },
      }),
    ).toThrow(/object type/);
  });

  it("coreFields 'none' requires the host schema to declare title", () => {
    expect(() => definePageSchema({ schema: articleFields, coreFields: { mode: 'none' } })).toThrow(/title/);
    expect(() => definePageSchema({ schema: starlightFields, coreFields: { mode: 'none' } })).not.toThrow();
  });

  it('wraps a bare host schema as a full-mode descriptor and passes a descriptor through', () => {
    expect(toPageSchemaDescriptor(articleFields)).toEqual({ schema: articleFields, coreFields: { mode: 'full' } });
    const descriptor = definePageSchema({ schema: starlightFields, coreFields: { mode: 'minimal' } });
    expect(toPageSchemaDescriptor(descriptor)).toBe(descriptor);
  });

  it('lists top-level field names from the metadata', () => {
    expect(hostSchemaFieldNames(starlightFields)).toEqual([
      'title',
      'description',
      'template',
      'draft',
      'editUrl',
      'sidebar',
    ]);
  });
});
