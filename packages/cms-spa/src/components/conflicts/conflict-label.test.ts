import { describe, expect, test } from 'bun:test';
import type { Config } from '@puckeditor/core';
import { createElement } from 'react';
import { resolveConflictLabel } from './conflict-label.js';

const render = () => createElement('div');

const config: Config = {
  components: {
    Hero: { label: 'Hero', fields: { title: { type: 'text', label: 'Hero title' } }, render },
    Columns: { label: 'Columns', fields: { left: { type: 'slot', label: 'Left column' } }, render },
    Text: { fields: { body: { type: 'textarea' } }, render },
  },
  root: { fields: { seoTitle: { type: 'text', label: 'SEO title' } } },
};

const data = {
  root: { props: { seoTitle: 'Sale' } },
  content: [
    { type: 'Hero', props: { id: 'hero-1', title: 'Spring sale' } },
    { type: 'Columns', props: { id: 'cols-1', left: [{ type: 'Hero', props: { id: 'hero-2', title: 'Left' } }] } },
    { type: 'Text', props: { id: 'text-1', body: 'Hi' } },
    { type: 'Banner', props: { id: 'banner-1', title: 'Old' } },
  ],
  zones: { 'cols-1:left': [{ type: 'Hero', props: { id: 'hero-3', title: 'Zone' } }] },
};

const label = (anchor: string) => resolveConflictLabel(anchor, data, config);
const PROSE = { component: null, field: 'a paragraph in the text' };
const REMOVED = { component: null, field: 'a field on a removed block' };

describe('resolveConflictLabel', () => {
  test('a field of a block in the content names the field and the component', () => {
    expect(label('content[id=hero-1].props.title')).toEqual({ component: 'Hero', field: 'Hero title' });
  });

  test('a field of a block in a slot, found by id through its parent', () => {
    expect(label('content[id=cols-1].props.left[id=hero-2].props.title')).toEqual({
      component: 'Hero',
      field: 'Hero title',
    });
  });

  test('a field of a block in a legacy zone', () => {
    expect(label('zones.cols-1:left[id=hero-3].props.title')).toEqual({ component: 'Hero', field: 'Hero title' });
  });

  test('a root field names the root field label and no component', () => {
    expect(label('root.props.seoTitle')).toEqual({ component: null, field: 'SEO title' });
  });

  test('page settings, data entry and MDX front matter keys show as written', () => {
    expect(label('meta.title')).toEqual({ component: null, field: 'title' });
    expect(label('data.price')).toEqual({ component: null, field: 'price' });
    expect(label('frontmatter.description')).toEqual({ component: null, field: 'description' });
  });

  test('every body anchor is a paragraph in the text', () => {
    for (const anchor of [
      'body#3f2a9c1b0d4e5a61',
      'body@start',
      'body@after#3f2a9c1b0d4e5a61',
      'body#3f2a9c1b0d4e5a61~2',
      'body#3f2a9c1b0d4e5a61+3',
    ]) {
      expect(label(anchor)).toEqual(PROSE);
    }
  });

  test('where a block sits, and the order of blocks', () => {
    expect(label('[id=hero-1]#place')).toEqual({ component: 'Hero', field: 'where Hero sits' });
    expect(label('content#order')).toEqual({ component: null, field: 'the order of blocks' });
    expect(label('content[id=cols-1].props.left#order')).toEqual({ component: null, field: 'the order of blocks' });
  });

  test('a quoted key, bare front matter and the whole page', () => {
    expect(label('["a.b"]')).toEqual({ component: null, field: 'a.b' });
    expect(label('frontmatter')).toEqual({ component: null, field: 'the page settings' });
    expect(label('')).toEqual({ component: null, field: 'the whole page' });
  });

  test('a block gone from the data or from the config is a removed block', () => {
    expect(label('content[id=gone].props.title')).toEqual(REMOVED);
    expect(label('content[id=banner-1].props.title')).toEqual(REMOVED);
    expect(label('[id=gone]#place')).toEqual(REMOVED);
  });

  test('an unknown field on a known block falls back to the last path segment', () => {
    expect(label('content[id=text-1].props.title')).toEqual({ component: 'Text', field: 'title' });
    expect(label('content[id=hero-1].props.cta.title')).toEqual({ component: 'Hero', field: 'title' });
  });

  test('a component without a label is named by its type', () => {
    expect(label('content[id=text-1].props.body')).toEqual({ component: 'Text', field: 'body' });
  });

  test('a file kept back by a git rule names the file', () => {
    expect(label('lfs:assets/video.mp4')).toEqual({ component: null, field: 'assets/video.mp4' });
  });
});
