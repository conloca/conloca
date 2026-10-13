/// <reference lib="dom" />
/**
 * Page settings opened from a part of a block on the editor canvas: the dialog
 * opens at the field that part shows, focused and scrolled into view, so the
 * author does not have to look for it. Opened from the header, it starts at
 * the top as before.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { render, waitFor } from '@testing-library/react';
import { z } from 'zod';
import { PageMetadataDialog } from '../src/components/dialogs/PageMetadataDialog.js';
import { definePageSchema } from '../src/page-schema-define.js';
import { setPageSchemas } from '../src/page-schemas.js';
import type { PageMetadata } from '../src/types.js';

const page: PageMetadata = {
  title: 'Post',
  description: '',
  pathname: '/blog/probe',
  publishDate: null,
  unpublishDate: null,
  customMeta: { author: 'Ada' },
  collection: 'pages',
  type: 'puck',
};

const originalScrollIntoView = Element.prototype.scrollIntoView;
let scrolled: Element[] = [];

beforeEach(() => {
  setPageSchemas({
    '/blog/': definePageSchema({
      label: 'Blog post',
      schema: z.object({ author: z.string().optional(), featuredImage: z.string().optional() }),
      ui: {
        author: { control: 'text', group: 'post' },
        featuredImage: { control: 'image', group: 'post', label: 'Featured image' },
      },
      groups: [{ id: 'post', label: 'Blog post' }],
    }),
  });
  scrolled = [];
  Element.prototype.scrollIntoView = function recordScroll(this: Element) {
    scrolled.push(this);
  };
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  setPageSchemas({});
});

/** A label's text without the asterisk a required field adds. */
const labelText = (label: HTMLLabelElement): string => label.textContent?.replace('*', '').trim() ?? '';

/** The form control a label with this text names. */
function controlLabelled(text: string): { label: HTMLLabelElement; control: HTMLElement } {
  const label = Array.from(document.body.querySelectorAll('label')).find((candidate) => labelText(candidate) === text);
  const control = label?.control;
  if (!label || !control) throw new Error(`no control is labelled "${text}"`);
  return { label, control };
}

/**
 * The focused element, told apart by what an author sees: the label naming a
 * control, else its accessible name. Compared as text because a failed match
 * between two DOM elements prints the whole document.
 */
function focused(): string {
  const active = document.activeElement;
  if (!active || active === document.body) return 'nothing';
  const label = (active as HTMLInputElement).labels?.[0];
  if (label) return `the control labelled "${labelText(label)}"`;
  return `${active.tagName.toLowerCase()} "${active.getAttribute('aria-label') ?? active.textContent ?? ''}"`;
}

/** Whether focus sits inside the settings form, as opposed to the dialog's own controls above it. */
const focusInsideForm = (): boolean => document.body.querySelector('form')?.contains(document.activeElement) === true;

describe('Page settings opened at a field a block showed', () => {
  test.each([
    ['title', 'Title'],
    ['author', 'Author'],
    ['publishAt', 'Publish At'],
    ['featuredImage', 'Featured image'],
  ])('opens at %s: its control is focused and the field is scrolled into view', async (name, text) => {
    render(<PageMetadataDialog open page={page} focusField={name} />);

    const { label, control } = controlLabelled(text);
    await waitFor(() => expect(focused()).toBe(`the control labelled "${text}"`));
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].contains(control)).toBe(true);
    expect(scrolled[0].contains(label)).toBe(true);
  });

  test('opened from the header, it starts at the top as before', async () => {
    render(<PageMetadataDialog open page={page} />);

    await waitFor(() => expect(focused()).not.toBe('nothing'));
    expect(focusInsideForm()).toBe(false);
    expect(scrolled).toHaveLength(0);
  });

  test('a setting this page has no field for opens at the top and says so in the console', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      render(<PageMetadataDialog open page={page} focusField="readTime" />);

      await waitFor(() => expect(focused()).not.toBe('nothing'));
      expect(focusInsideForm()).toBe(false);
      expect(scrolled).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('readTime');
    } finally {
      warn.mockRestore();
    }
  });
});
