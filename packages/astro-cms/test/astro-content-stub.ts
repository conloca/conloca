import { mock } from 'bun:test';

/** What the stubbed getCollection serves, by collection name: the data of each entry. */
export const stubCollections: Record<string, Record<string, unknown>[]> = {};

// astro:content resolves only inside an Astro build. Bun's module mocks are
// process-wide, and mocking a module again cannot add an export the first mock
// lacked, so every test file imports this one stub, which carries every export
// the package reads from astro:content.
mock.module('astro:content', () => ({
  defineCollection: (input: unknown) => input,
  getCollection: async (collection: string) => (stubCollections[collection] ?? []).map((data) => ({ data })),
}));
