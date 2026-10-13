/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { HintForm } from '../src/components/forms/HintForm.js';

afterEach(() => {
  cleanup();
});

describe('HintForm shows the help text a hint gives each field', () => {
  test('shows a chips field help once, below the field, and keeps the tag input hint', () => {
    const hints = {
      tags: { control: 'chips' as const, label: 'Tags', help: 'Chips help' },
    };
    render(<HintForm hints={hints} values={{}} onChange={() => {}} />);

    expect(screen.getByRole('textbox').getAttribute('placeholder')).toBe('Type and press Enter to add');
    expect(screen.getAllByText('Chips help')).toHaveLength(1);
  });
});
