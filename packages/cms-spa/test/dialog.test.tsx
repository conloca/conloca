/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import * as Dialog from '../src/components/dialog';

afterEach(() => {
  cleanup();
});

function renderOpenDialog(contentProps: Parameters<typeof Dialog.Content>[0] = {}) {
  return render(
    <Dialog.Root open onOpenChange={() => {}}>
      <Dialog.Portal>
        <Dialog.Overlay data-testid="overlay" />
        <Dialog.Content {...contentProps}>
          <Dialog.Title>Title</Dialog.Title>
          <Dialog.Description>Body copy.</Dialog.Description>
          <Dialog.Close>Close me</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>,
  );
}

describe('dialog wrapper', () => {
  test('renders Title, Description, and Close inside Content', () => {
    renderOpenDialog();
    expect(screen.getByText('Title')).toBeTruthy();
    expect(screen.getByText('Body copy.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close me' })).toBeTruthy();
  });

  test('Overlay bakes in the cms-spa overlay recipe', () => {
    renderOpenDialog();
    const overlay = screen.getByTestId('overlay');
    expect(overlay.className).toContain('fixed');
    expect(overlay.className).toContain('inset-0');
    expect(overlay.className).toContain('bg-black/50');
    expect(overlay.className).toContain('backdrop-blur-sm');
  });

  test('Overlay does NOT bake a z-index by default so existing dialogs keep their stacking', () => {
    renderOpenDialog();
    const overlay = screen.getByTestId('overlay');
    expect(overlay.className).not.toMatch(/\bz-\d/);
  });

  test('Content surface=overlay (default) uses bg-overlay + rounded-lg', () => {
    renderOpenDialog();
    const content = screen.getByRole('dialog');
    expect(content.className).toContain('bg-overlay');
    expect(content.className).toContain('rounded-lg');
    expect(content.className).toContain('shadow-lg');
    expect(content.className).not.toContain('rounded-md');
    expect(content.className).not.toContain('dark:bg-grey-02');
  });

  test('Content surface=panel uses bg-white/grey-02 + grey-09/grey-03 border + rounded-md', () => {
    renderOpenDialog({ surface: 'panel' });
    const content = screen.getByRole('dialog');
    expect(content.className).toContain('bg-white');
    expect(content.className).toContain('dark:bg-grey-02');
    expect(content.className).toContain('border');
    expect(content.className).toContain('border-grey-09');
    expect(content.className).toContain('dark:border-grey-03');
    expect(content.className).toContain('rounded-md');
    expect(content.className).not.toContain('rounded-lg');
    expect(content.className).not.toContain('bg-overlay');
  });

  test('Content bakes in the centered + capped layout shared by both surfaces', () => {
    renderOpenDialog();
    const content = screen.getByRole('dialog');
    expect(content.className).toContain('fixed');
    expect(content.className).toContain('top-1/2');
    expect(content.className).toContain('left-1/2');
    expect(content.className).toContain('-translate-x-1/2');
    expect(content.className).toContain('-translate-y-1/2');
    expect(content.className).toContain('p-6');
    expect(content.className).toContain('max-h-[90vh]');
    expect(content.className).toContain('overflow-y-auto');
  });

  test('Content forwards consumer className for per-dialog width', () => {
    renderOpenDialog({ className: 'w-[calc(100vw-2rem)] max-w-md z-50' });
    const content = screen.getByRole('dialog');
    expect(content.className).toContain('w-[calc(100vw-2rem)]');
    expect(content.className).toContain('max-w-md');
    expect(content.className).toContain('z-50');
  });
});
