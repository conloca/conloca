import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Loader, LoaderContext } from 'astro/loaders';
import {
  assertCollectionsDeclared,
  declareConlocaCollection,
  resetDeclaredCollections,
  withDeclarationCheck,
} from '../src/internal/declared-collections.js';

describe('collection declaration check', () => {
  beforeEach(() => {
    resetDeclaredCollections();
  });

  it('accepts disk collections that are all declared', () => {
    declareConlocaCollection('page', 'pages');
    declareConlocaCollection('data', 'testimonials');
    expect(() => assertCollectionsDeclared(['page:pages', 'data:testimonials'])).not.toThrow();
  });

  it('names every undeclared disk collection with its kind and how to declare it', () => {
    declareConlocaCollection('page', 'pages');
    expect(() => assertCollectionsDeclared(['page:pages', 'data:faqs', 'fragment:authors'])).toThrow(
      /the data collection "faqs", the fragment collection "authors"/,
    );
    expect(() => assertCollectionsDeclared(['page:pages', 'data:faqs', 'fragment:authors'])).toThrow(/conlocaPages/);
    // schema-first is allowed: declared with no directory is not an error
    declareConlocaCollection('data', 'faqs');
    declareConlocaCollection('fragment', 'authors');
    declareConlocaCollection('data', 'not-on-disk-yet');
    expect(() => assertCollectionsDeclared(['page:pages', 'data:faqs', 'fragment:authors'])).not.toThrow();
  });

  it('reports a duplicated qualified name once', () => {
    expect(() => assertCollectionsDeclared(['data:authors', 'data:authors'])).toThrow(
      /declare: the data collection "authors"\./,
    );
  });

  it('a data collection does not cover a fragment of the same name — kinds are separate namespaces', () => {
    declareConlocaCollection('data', 'general');
    expect(() => assertCollectionsDeclared(['data:general', 'fragment:general'])).toThrow(
      /the fragment collection "general"/,
    );
  });
});

describe('withDeclarationCheck', () => {
  let root: string;
  let options: { contentRoot: string; site: string };

  beforeEach(() => {
    resetDeclaredCollections();
    root = mkdtempSync(join(tmpdir(), 'conloca-declared-'));
    mkdirSync(join(root, 'data', 'seeded'), { recursive: true });
    writeFileSync(join(root, 'data', 'seeded', 'item.en.json'), '{}');
    options = { contentRoot: root, site: 'default' };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Inner loader that records the contexts it was handed, so pass-through is pinnable. */
  function fakeLoader(seen: LoaderContext[]): Loader {
    return {
      name: 'fake',
      load: async (context: LoaderContext) => {
        seen.push(context);
      },
    };
  }

  it('rejects every wrapped loader sharing a root, without running the inner loader', async () => {
    const seen: LoaderContext[] = [];
    const first = withDeclarationCheck(fakeLoader(seen), options);
    const second = withDeclarationCheck(fakeLoader(seen), options);
    const context = { collection: 'seeded' } as LoaderContext;

    await expect(first.load(context)).rejects.toThrow(/"seeded"/);
    await expect(second.load(context)).rejects.toThrow(/"seeded"/);
    expect(seen).toEqual([]);
  });

  it('a declared data collection does not hide an undeclared fragment folder of the same name', async () => {
    // The exact silent-skip this feature exists to kill: one flat registry
    // would let data "general" satisfy the check for the fragment FOLDER
    // "general", whose entries then never build.
    mkdirSync(join(root, 'fragments', 'general'), { recursive: true });
    writeFileSync(join(root, 'fragments', 'general', 'note.en.vxjson'), '{}');
    declareConlocaCollection('data', 'seeded');
    declareConlocaCollection('data', 'general');
    const loader = withDeclarationCheck(fakeLoader([]), options);

    await expect(loader.load({ collection: 'seeded' } as LoaderContext)).rejects.toThrow(
      /the fragment collection "general"/,
    );
  });

  it('passes the untouched context to the inner loader once the collection is declared', async () => {
    const seen: LoaderContext[] = [];
    declareConlocaCollection('data', 'seeded');
    const loader = withDeclarationCheck(fakeLoader(seen), options);
    const context = { collection: 'seeded' } as LoaderContext;

    await loader.load(context);

    expect(seen).toEqual([context]);
    expect(seen[0]).toBe(context);
  });

  it('recovers once the reported collection is declared, without a restart', async () => {
    const seen: LoaderContext[] = [];
    const loader = withDeclarationCheck(fakeLoader(seen), options);
    const context = { collection: 'seeded' } as LoaderContext;

    await expect(loader.load(context)).rejects.toThrow(/"seeded"/);

    // The dev loop: the user declares the collection the error named and the
    // config re-evaluates. That reload does NOT reset module state, so a
    // memoised failure would keep throwing until the server restarted.
    declareConlocaCollection('data', 'seeded');

    await loader.load(context);

    expect(seen).toEqual([context]);
  });
});
