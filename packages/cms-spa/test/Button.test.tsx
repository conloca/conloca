/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { Button } from '../src/components/ui/Button';

afterEach(() => {
  cleanup();
});

describe('Button', () => {
  describe('variants', () => {
    test('primary renders with the azure-04 fill', () => {
      render(<Button>Save</Button>);
      const btn = screen.getByRole('button', { name: 'Save' });
      expect(btn.className).toContain('bg-azure-04');
      expect(btn.className).toContain('hover:bg-azure-03');
    });

    test('outline renders with border + panel surface', () => {
      render(<Button variant="outline">Cancel</Button>);
      const btn = screen.getByRole('button', { name: 'Cancel' });
      expect(btn.className).toContain('border');
      expect(btn.className).toContain('border-line');
      expect(btn.className).toContain('bg-panel');
    });

    test('ghost has no resting fill', () => {
      render(<Button variant="ghost">Ghost</Button>);
      const btn = screen.getByRole('button', { name: 'Ghost' });
      expect(btn.className).not.toContain('bg-azure-04');
      expect(btn.className).not.toContain('bg-panel');
      expect(btn.className).not.toContain('bg-grey-11');
      expect(btn.className).toContain('hover:bg-hover');
    });

    test('tonal renders with grey-11/grey-03 fill and the cms-spa hover token', () => {
      render(<Button variant="tonal">Cancel</Button>);
      const btn = screen.getByRole('button', { name: 'Cancel' });
      expect(btn.className).toContain('bg-grey-11');
      expect(btn.className).toContain('dark:bg-grey-03');
      expect(btn.className).toContain('text-grey-04');
      expect(btn.className).toContain('dark:text-grey-07');
      expect(btn.className).toContain('hover:bg-grey-10');
      expect(btn.className).toContain('dark:hover:bg-hover');
    });

    test('destructive renders with the red-04 fill', () => {
      render(<Button variant="destructive">Delete</Button>);
      const btn = screen.getByRole('button', { name: 'Delete' });
      expect(btn.className).toContain('bg-red-04');
      expect(btn.className).toContain('hover:bg-red-03');
    });
  });

  describe('sizes', () => {
    test('default size is px-4 py-2', () => {
      render(<Button>X</Button>);
      const btn = screen.getByRole('button', { name: 'X' });
      expect(btn.className).toContain('px-4');
      expect(btn.className).toContain('py-2');
    });

    test('sm size is px-3 py-1.5 text-sm (h-8 by ratio)', () => {
      render(<Button size="sm">X</Button>);
      const btn = screen.getByRole('button', { name: 'X' });
      expect(btn.className).toContain('px-3');
      expect(btn.className).toContain('py-1.5');
      expect(btn.className).toContain('text-sm');
    });
  });

  describe('attributes and forwarding', () => {
    test('defaults type to "button" so a Button inside a form does not submit', () => {
      render(<Button>X</Button>);
      const btn = screen.getByRole('button', { name: 'X' }) as HTMLButtonElement;
      expect(btn.type).toBe('button');
    });

    test('honors an explicit type="submit"', () => {
      render(<Button type="submit">Save</Button>);
      const btn = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
      expect(btn.type).toBe('submit');
    });

    test('disabled propagates to the underlying element', () => {
      render(<Button disabled>X</Button>);
      const btn = screen.getByRole('button', { name: 'X' }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.className).toContain('disabled:opacity-50');
      expect(btn.className).toContain('disabled:cursor-not-allowed');
    });

    test('appends consumer className to the variant classes', () => {
      render(<Button className="font-medium custom-anchor">X</Button>);
      const btn = screen.getByRole('button', { name: 'X' });
      expect(btn.className).toContain('font-medium');
      expect(btn.className).toContain('custom-anchor');
      expect(btn.className).toContain('bg-azure-04');
    });
  });
});
