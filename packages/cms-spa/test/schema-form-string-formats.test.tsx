/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { SchemaForm } from '../src/components/forms/SchemaForm.js';
import { fieldsOfHostSchema } from '../src/utils/schema-fields.js';
import { stringFormatFields } from './fixtures/typia/host-schemas.js';

afterEach(() => {
  cleanup();
});

function inputOf(label: string): HTMLInputElement {
  const input = screen.getByLabelText(label);
  if (!(input instanceof HTMLInputElement)) throw new Error(`${label} is not an input`);
  return input;
}

describe('SchemaForm gives web address, email and length-limited fields their inputs', () => {
  test('a url or uri formatted string gets a web address input', () => {
    render(<SchemaForm schema={stringFormatFields} values={{}} onChange={() => {}} />);

    expect(inputOf('Homepage').type).toBe('url');
    expect(inputOf('Website').type).toBe('url');
  });

  test('an email formatted string gets an email input', () => {
    render(<SchemaForm schema={stringFormatFields} values={{}} onChange={() => {}} />);

    expect(inputOf('Contact').type).toBe('email');
  });

  test('a length-limited string counts its characters against the limit', () => {
    render(<SchemaForm schema={stringFormatFields} values={{}} onChange={() => {}} />);

    expect(screen.getByText('0/160 characters')).toBeTruthy();
  });
});

describe('a field keeps its format and its length limit together', () => {
  test('a web address with a length limit', () => {
    expect(fieldsOfHostSchema(stringFormatFields).link).toMatchObject({ format: 'url', maxLength: 200 });
  });

  test('an email with a length limit', () => {
    expect(fieldsOfHostSchema(stringFormatFields).mailbox).toMatchObject({ format: 'email', maxLength: 100 });
  });
});
