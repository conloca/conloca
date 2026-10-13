/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { z } from 'zod';
import { SchemaForm } from '../src/components/forms/SchemaForm.js';

afterEach(() => {
  cleanup();
});

describe('SchemaForm shows the help text a schema gives each field', () => {
  test('shows the help of a required field', () => {
    const schema = z.object({ title: z.string().describe('Title help') });
    render(<SchemaForm schema={schema} values={{}} onChange={() => {}} />);

    expect(screen.getByText('Title help')).toBeTruthy();
  });

  test('shows the help of an optional field described after .optional()', () => {
    const schema = z.object({ robots: z.string().optional().describe('Robots help') });
    render(<SchemaForm schema={schema} values={{}} onChange={() => {}} />);

    expect(screen.getByText('Robots help')).toBeTruthy();
  });

  test('shows the help of a nullable optional date described last', () => {
    const schema = z.object({ publishAt: z.coerce.date().nullable().optional().describe('Publish help') });
    render(<SchemaForm schema={schema} values={{}} onChange={() => {}} />);

    expect(screen.getByText('Publish help')).toBeTruthy();
    expect(document.querySelector('input[type="datetime-local"]')).toBeTruthy();
  });

  test('shows help given before the wrapper', () => {
    const schema = z.object({ category: z.string().describe('Category help').optional() });
    render(<SchemaForm schema={schema} values={{}} onChange={() => {}} />);

    expect(screen.getByText('Category help')).toBeTruthy();
  });

  test('shows the outermost help when a field is described twice', () => {
    const schema = z.object({ summary: z.string().describe('Inner help').optional().describe('Outer help') });
    render(<SchemaForm schema={schema} values={{}} onChange={() => {}} />);

    expect(screen.getByText('Outer help')).toBeTruthy();
    expect(screen.queryByText('Inner help')).toBeNull();
  });

  test('shows help set through .meta()', () => {
    const schema = z.object({ rating: z.number().optional().meta({ description: 'Rating help' }) });
    render(<SchemaForm schema={schema} values={{}} onChange={() => {}} />);

    expect(screen.getByText('Rating help')).toBeTruthy();
  });

  test('shows a list field help once, below the field, and keeps the tag input hint', () => {
    const schema = z.object({ tags: z.array(z.string()).optional().describe('Tags help') });
    render(<SchemaForm schema={schema} values={{}} onChange={() => {}} />);

    expect(screen.getByRole('textbox').getAttribute('placeholder')).toBe('Type and press Enter to add');
    expect(screen.getAllByText('Tags help')).toHaveLength(1);
  });
});
