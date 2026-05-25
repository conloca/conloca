/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { MediaIssueBadge } from '../src/media/MediaIssueBadge';

afterEach(() => {
  cleanup();
});

describe('MediaIssueBadge', () => {
  test('renders nothing when issue is null (no host bridge / healthy asset)', () => {
    const { container } = render(<MediaIssueBadge issue={null} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders the short "Blocked" label for the sm blocked variant', () => {
    render(
      <MediaIssueBadge issue={{ kind: 'blocked', filename: 'foo.jpg', reason: 'Still being scanned.' }} size="sm" />,
    );
    const badge = screen.getByRole('status', { name: /media issue: blocked/i });
    expect(badge.textContent).toBe('Blocked');
  });

  test('renders the short "Oversized" label for the sm oversized variant', () => {
    render(
      <MediaIssueBadge
        issue={{ kind: 'oversized', filename: 'big.png', sizeBytes: 5_000_000, limitBytes: 2_000_000 }}
        size="sm"
      />,
    );
    const badge = screen.getByRole('status', { name: /media issue: oversized/i });
    expect(badge.textContent).toBe('Oversized');
  });

  test('renders the full scanner reason for the md blocked variant', () => {
    render(
      <MediaIssueBadge
        issue={{
          kind: 'blocked',
          filename: 'foo.jpg',
          reason: 'Flagged by the malware scanner — contact support.',
        }}
        size="md"
      />,
    );
    const badge = screen.getByRole('status');
    expect(badge.textContent).toContain('Blocked');
    expect(badge.textContent).toContain('Flagged by the malware scanner');
  });

  test('renders the size delta for the md oversized variant', () => {
    render(
      <MediaIssueBadge
        issue={{ kind: 'oversized', filename: 'big.png', sizeBytes: 5_400_000, limitBytes: 2_000_000 }}
        size="md"
      />,
    );
    const badge = screen.getByRole('status');
    expect(badge.textContent).toContain('Oversized');
    expect(badge.textContent).toContain('5.4 MB');
    expect(badge.textContent).toContain('2 MB');
    expect(badge.textContent).toMatch(/media storage/i);
  });

  test('paints blocked in red (destructive vocabulary)', () => {
    render(<MediaIssueBadge issue={{ kind: 'blocked', filename: 'foo.jpg', reason: 'r' }} />);
    const badge = screen.getByRole('status');
    expect(badge.className).toMatch(/bg-red-/);
    expect(badge.className).toMatch(/text-red-/);
  });

  test('paints oversized in amber (warning vocabulary)', () => {
    render(<MediaIssueBadge issue={{ kind: 'oversized', filename: 'big.png', sizeBytes: 1, limitBytes: 1 }} />);
    const badge = screen.getByRole('status');
    expect(badge.className).toMatch(/bg-amber-/);
    expect(badge.className).toMatch(/text-amber-/);
  });

  test('honours the size prop (sm vs md)', () => {
    const { rerender } = render(
      <MediaIssueBadge issue={{ kind: 'blocked', filename: 'foo.jpg', reason: 'r' }} size="sm" />,
    );
    const small = screen.getByRole('status');
    expect(small.className).toContain('text-[10px]');

    rerender(<MediaIssueBadge issue={{ kind: 'blocked', filename: 'foo.jpg', reason: 'r' }} size="md" />);
    const medium = screen.getByRole('status');
    expect(medium.className).toContain('text-xs');
  });
});
