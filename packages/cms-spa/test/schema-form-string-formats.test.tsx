/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { z } from 'zod';
import { z as z3 } from 'zod/v3';
import { SchemaForm } from '../src/components/forms/SchemaForm.js';
import { getZodFieldInfo } from '../src/utils/zodIntrospect.js';

afterEach(() => {
  cleanup();
});

function renderField(field: z.ZodTypeAny) {
  render(<SchemaForm schema={z.object({ field })} values={{}} onChange={() => {}} />);
}

/** A site on zod 3 hands the form zod 3 schemas; the form reads them at runtime, so only the types differ. */
function asZod4(schema: unknown): z.ZodTypeAny {
  return schema as unknown as z.ZodTypeAny;
}

describe('SchemaForm gives web address, email and length-limited fields their inputs', () => {
  test('a string checked with .url() gets a web address input', () => {
    renderField(z.string().url().optional());

    expect(document.querySelector('input[type="url"]')).toBeTruthy();
  });

  test('a z.url() or z.httpUrl() field gets a web address input', () => {
    renderField(z.url().optional());
    expect(document.querySelector('input[type="url"]')).toBeTruthy();
    cleanup();

    renderField(z.httpUrl().optional());
    expect(document.querySelector('input[type="url"]')).toBeTruthy();
  });

  test('a string checked with .email() gets an email input', () => {
    renderField(z.string().email().optional());

    expect(document.querySelector('input[type="email"]')).toBeTruthy();
  });

  test('a z.email() field gets an email input', () => {
    renderField(z.email().optional());

    expect(document.querySelector('input[type="email"]')).toBeTruthy();
  });

  test('a string with .max() counts its characters against the limit', () => {
    renderField(z.string().max(160));

    expect(screen.getByText('0/160 characters')).toBeTruthy();
  });

  test('still reads zod 3 schemas', () => {
    renderField(asZod4(z3.string().url().optional()));
    expect(document.querySelector('input[type="url"]')).toBeTruthy();
    cleanup();

    renderField(asZod4(z3.string().email().optional()));
    expect(document.querySelector('input[type="email"]')).toBeTruthy();
    cleanup();

    renderField(asZod4(z3.string().max(160)));
    expect(screen.getByText('0/160 characters')).toBeTruthy();
  });
});

describe('getZodFieldInfo keeps a field format and its length limit together', () => {
  test('a zod 4 web address with a length limit', () => {
    expect(getZodFieldInfo(z.string().url().max(200))).toMatchObject({ format: 'url', maxLength: 200 });
    expect(getZodFieldInfo(z.url().max(200))).toMatchObject({ format: 'url', maxLength: 200 });
  });

  test('a zod 4 email with a length limit', () => {
    expect(getZodFieldInfo(z.email().max(100))).toMatchObject({ format: 'email', maxLength: 100 });
  });

  test('a zod 3 web address with a length limit', () => {
    expect(getZodFieldInfo(asZod4(z3.string().url().max(200)))).toMatchObject({ format: 'url', maxLength: 200 });
  });
});
