/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { SchemaForm } from '../src/components/forms/SchemaForm.js';
import { helpTextFields } from './fixtures/typia/host-schemas.js';

afterEach(() => {
  cleanup();
});

describe('SchemaForm shows the help text a schema gives each field', () => {
  test('shows the help of a required field', () => {
    render(<SchemaForm schema={helpTextFields} values={{}} onChange={() => {}} />);

    expect(screen.getByText('Title help')).toBeTruthy();
  });

  test('shows the help of an optional field', () => {
    render(<SchemaForm schema={helpTextFields} values={{}} onChange={() => {}} />);

    expect(screen.getByText('Robots help')).toBeTruthy();
    expect(screen.getByText('Rating help')).toBeTruthy();
  });

  test('shows the help of a nullable optional date and gives it a date-time input', () => {
    render(<SchemaForm schema={helpTextFields} values={{}} onChange={() => {}} />);

    expect(screen.getByText('Publish help')).toBeTruthy();
    expect(document.querySelector('input[type="datetime-local"]')).toBeTruthy();
  });

  test('shows a list field help once, below the field, and keeps the tag input hint', () => {
    render(<SchemaForm schema={helpTextFields} values={{}} onChange={() => {}} />);

    expect(
      screen
        .getAllByRole('textbox')
        .some((input) => input.getAttribute('placeholder') === 'Type and press Enter to add'),
    ).toBe(true);
    expect(screen.getAllByText('Tags help')).toHaveLength(1);
  });
});
