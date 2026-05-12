import type { BlockEditable, DataEditable } from '@conloca/content-api-client';

export interface Page {
  id: string;
  title: string;
  path: string;
  /** Underlying content format. 'puck' = Puck visual editor, 'mdx' = MDX source editor. */
  type: 'puck' | 'mdx';
  status: 'draft' | 'scheduled' | 'published';
  modified: Date;
  locales: string[];
}

export interface Block {
  id: string;
  title: string;
  preview: string;
  category: string;
  locales: string[];
  etag: string;
  name?: string; // The filename for this block
  meta?: BlockEditable;
}

export interface DataEntry {
  id: string;
  title: string;
  description?: string;
  collection: string;
  locales: string[];
  etag: string;
  name?: string;
  meta?: DataEditable;
}

export interface PageMetadata {
  title: string;
  description: string;
  pathname: string;
  publishDate: Date | null;
  unpublishDate: Date | null;
  robots?: string;
  canonical?: string;
  customMeta?: Record<string, unknown>;
  /** Content collection the page belongs to — drives schema resolution. */
  collection?: string;
  /** Content format — drives schema resolution and editor selection. */
  type?: 'puck' | 'mdx';
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export interface CreatePageData {
  title: string;
  path: string;
  template: string;
  locale: string;
  /** Content format. Defaults to 'puck' (the visual editor). */
  format: 'puck' | 'mdx';
  /** Optional description, currently only used for MDX pages where Starlight recommends one. */
  description?: string;
}
