/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { AssetScopePill } from '../src/media/AssetScopePill';

afterEach(() => {
  cleanup();
});

describe('AssetScopePill', () => {
  test('renders nothing when scope is null (no host bridge installed)', () => {
    const { container } = render(<AssetScopePill scope={null} />);
    // Empty when there's no scope — the AssetCard / AssetDetailSidebar
    // call sites render this unconditionally and rely on it to
    // disappear in astro-cms / local dev.
    expect(container.firstChild).toBeNull();
  });

  test('renders the "Branch only" label for scope=branch', () => {
    render(<AssetScopePill scope="branch" />);
    const pill = screen.getByRole('status', { name: /asset scope: branch only/i });
    expect(pill.textContent).toBe('Branch only');
  });

  test('renders the "Published" label for scope=published', () => {
    render(<AssetScopePill scope="published" />);
    const pill = screen.getByRole('status', { name: /asset scope: published/i });
    expect(pill.textContent).toBe('Published');
  });

  test('paints branch in amber (work-in-flight vocabulary)', () => {
    render(<AssetScopePill scope="branch" />);
    const pill = screen.getByRole('status');
    // Amber matches the git-status / divergence "work in flight" idiom.
    expect(pill.className).toMatch(/bg-yellow-/);
    expect(pill.className).toMatch(/text-yellow-/);
  });

  test('paints published in green (live vocabulary)', () => {
    render(<AssetScopePill scope="published" />);
    const pill = screen.getByRole('status');
    // Green matches the deploy "live" indicator.
    expect(pill.className).toMatch(/bg-green-/);
    expect(pill.className).toMatch(/text-green-/);
  });

  test('honours the size prop (sm vs md)', () => {
    const { rerender } = render(<AssetScopePill scope="branch" size="sm" />);
    const small = screen.getByRole('status');
    expect(small.className).toContain('text-[10px]');

    rerender(<AssetScopePill scope="branch" size="md" />);
    const medium = screen.getByRole('status');
    expect(medium.className).toContain('text-xs');
  });
});
