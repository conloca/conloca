import type { BlockEditable, DataEditable } from '@conloca/content-api';

export interface Page {
  id: string;
  title: string;
  path: string;
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
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export interface CreatePageData {
  title: string;
  path: string;
  template: string;
  locale: string;
}
