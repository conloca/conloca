/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { FieldError } from '../src/components/ui/FieldError';

afterEach(() => {
  cleanup();
});

describe('FieldError', () => {
  test('renders with role="alert" so assistive tech announces the message', () => {
    render(<FieldError>Name is required.</FieldError>);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Name is required.');
  });

  test('renders the AlertCircle icon next to the message', () => {
    const { container } = render(<FieldError>boom</FieldError>);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('class')).toContain('h-3');
    expect(svg?.getAttribute('class')).toContain('w-3');
  });

  test('uses the form-error vocabulary (text-xs + text-red-04)', () => {
    render(<FieldError>boom</FieldError>);
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('text-xs');
    expect(alert.className).toContain('text-red-04');
    expect(alert.className).toContain('inline-flex');
    expect(alert.className).toContain('items-center');
    expect(alert.className).toContain('gap-2');
  });

  test('exposes id so the field can wire aria-describedby', () => {
    render(<FieldError id="email-error">Bad email.</FieldError>);
    const alert = screen.getByRole('alert');
    expect(alert.id).toBe('email-error');
  });

  test('appends consumer className', () => {
    render(<FieldError className="custom-anchor">x</FieldError>);
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('custom-anchor');
    expect(alert.className).toContain('text-red-04');
  });
});
