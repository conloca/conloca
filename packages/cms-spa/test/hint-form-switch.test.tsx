/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { HintForm } from '../src/components/forms/HintForm.js';

afterEach(cleanup);

const hints = {
  featured: { control: 'switch' as const, label: 'Featured' },
};

describe('HintForm switch fields', () => {
  for (const value of ['false', '0', 1, [], {}]) {
    test(`does not display ${JSON.stringify(value)} as enabled`, () => {
      render(<HintForm hints={hints} values={{ featured: value }} onChange={() => {}} />);
      expect((screen.getByRole('checkbox', { name: 'Featured' }) as HTMLInputElement).checked).toBe(false);
    });
  }

  test('displays the literal boolean true as enabled', () => {
    render(<HintForm hints={hints} values={{ featured: true }} onChange={() => {}} />);
    expect((screen.getByRole('checkbox', { name: 'Featured' }) as HTMLInputElement).checked).toBe(true);
  });
});
