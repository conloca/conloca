/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { Input } from '../src/components/ui/Input';

afterEach(() => {
  cleanup();
});

describe('Input', () => {
  describe('size', () => {
    test('default size uses px-3 py-2 (no text-sm)', () => {
      render(<Input aria-label="x" />);
      const input = screen.getByLabelText('x');
      expect(input.className).toContain('px-3');
      expect(input.className).toContain('py-2');
      expect(input.className).not.toContain('text-sm');
      expect(input.className).not.toContain('h-8');
    });

    test('sm size adds text-sm but keeps padding-driven height', () => {
      render(<Input aria-label="x" size="sm" />);
      const input = screen.getByLabelText('x');
      expect(input.className).toContain('px-3');
      expect(input.className).toContain('py-2');
      expect(input.className).toContain('text-sm');
    });

    test('xs size locks height to h-8 with text-sm and px-3', () => {
      render(<Input aria-label="x" size="xs" />);
      const input = screen.getByLabelText('x');
      expect(input.className).toContain('h-8');
      expect(input.className).toContain('px-3');
      expect(input.className).toContain('text-sm');
      expect(input.className).not.toContain('py-2');
    });
  });

  describe('surface', () => {
    test('panel surface (default) uses bg-panel + border-line', () => {
      render(<Input aria-label="x" />);
      const input = screen.getByLabelText('x');
      expect(input.className).toContain('bg-panel');
      expect(input.className).toContain('border-line');
      expect(input.className).not.toContain('bg-white');
      expect(input.className).not.toContain('dark:bg-grey-01');
    });

    test('elevated surface uses bg-white/grey-01 + grey-09/grey-04 borders', () => {
      render(<Input aria-label="x" surface="elevated" />);
      const input = screen.getByLabelText('x');
      expect(input.className).toContain('bg-white');
      expect(input.className).toContain('dark:bg-grey-01');
      expect(input.className).toContain('border-grey-09');
      expect(input.className).toContain('dark:border-grey-04');
      expect(input.className).not.toContain('bg-panel');
      expect(input.className).not.toContain('border-line');
    });
  });

  describe('intrinsic', () => {
    test('default lays the input out at w-full', () => {
      render(<Input aria-label="x" />);
      const input = screen.getByLabelText('x');
      expect(input.className).toContain('w-full');
    });

    test('intrinsic drops w-full so the input can sit in inline-flex rows', () => {
      render(<Input aria-label="x" intrinsic />);
      const input = screen.getByLabelText('x');
      expect(input.className).not.toContain('w-full');
    });
  });

  describe('error state', () => {
    test('error swaps the border + ring to red-04 on the panel surface', () => {
      render(<Input aria-label="x" error />);
      const input = screen.getByLabelText('x');
      expect(input.className).toContain('border-red-04');
      expect(input.className).toContain('focus:ring-red-04');
      expect(input.className).not.toContain('border-line');
      expect(input.className).not.toContain('border-grey-09');
    });

    test('error swaps the border + ring to red-04 on the elevated surface too', () => {
      render(<Input aria-label="x" surface="elevated" error />);
      const input = screen.getByLabelText('x');
      expect(input.className).toContain('border-red-04');
      expect(input.className).not.toContain('border-grey-09');
    });
  });

  describe('forwarding', () => {
    test('forwards props through to the underlying input', () => {
      render(<Input aria-label="x" placeholder="branch-name" required />);
      const input = screen.getByLabelText('x') as HTMLInputElement;
      expect(input.placeholder).toBe('branch-name');
      expect(input.required).toBe(true);
    });

    test('appends consumer className to the variant classes', () => {
      render(<Input aria-label="x" intrinsic className="min-w-[160px]" />);
      const input = screen.getByLabelText('x');
      expect(input.className).toContain('min-w-[160px]');
      expect(input.className).not.toContain('w-full');
    });
  });
});
