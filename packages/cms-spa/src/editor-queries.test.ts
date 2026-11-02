import { describe, expect, test } from 'bun:test';
import { invalidateEditorQueries, registerEditorQueriesForwarder } from './editor-queries.js';

describe('the editor queries forwarder', () => {
  test('a stale unregister leaves the newer forwarder in place', () => {
    const older: string[] = [];
    const newer: string[] = [];
    const unregisterOlder = registerEditorQueriesForwarder((queries) => older.push(queries));
    const unregisterNewer = registerEditorQueriesForwarder((queries) => newer.push(queries));
    unregisterOlder();
    invalidateEditorQueries('content');
    unregisterNewer();
    invalidateEditorQueries('media');
    expect(older).toEqual([]);
    expect(newer).toEqual(['content']);
  });
});
