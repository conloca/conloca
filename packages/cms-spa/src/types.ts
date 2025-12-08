import type { ContentEditable } from '@conloca/content-api';

export interface ContentStats {
  totalPages?: number;
  totalBlocks?: number;
  pagesByLocale?: Record<string, number>;
  blocksByLocale?: Record<string, number>;
}

export interface RecentChange {
  id: string;
  message: string;
  author: string;
  date: Date;
}

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
  meta?: ContentEditable;
}

export interface DataEntry {
  id: string;
  title: string;
  description?: string;
  collection: string;
  locales: string[];
  etag: string;
  name?: string;
  meta?: ContentEditable;
}

export interface PageMetadata {
  title: string;
  description: string;
  pathname: string;
  publishDate: Date | null;
  unpublishDate: Date | null;
  robots?: string;
  canonical?: string;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export interface CreatePageData {
  title: string;
  path: string;
  template: 'blank' | 'landing' | 'article';
  locale: string;
}
