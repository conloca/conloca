import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonInput } from '../src/lib/json-input.js';
import type { PageWriteError } from '../src/lib/page-write.js';

async function withFile(text: string, run: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'conloca-json-input-'));
  try {
    const path = join(dir, 'input.json');
    await Bun.write(path, text);
    await run(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('readJsonInput', () => {
  test('parses a JSON file', async () => {
    await withFile('{"root":{},"content":[]}', async (path) => {
      expect(await readJsonInput(path, '--content')).toEqual({ root: {}, content: [] });
    });
  });

  test('names the flag when the file is not JSON', async () => {
    await withFile('{not json', async (path) => {
      await expect(readJsonInput(path, '--content')).rejects.toMatchObject({
        reason: 'invalid_input',
        field: '--content',
        message: expect.stringMatching(/^--content is not JSON/),
      } satisfies Partial<PageWriteError>);
    });
  });

  test('refuses empty input', async () => {
    await withFile('', async (path) => {
      await expect(readJsonInput(path, '--data')).rejects.toMatchObject({
        reason: 'invalid_input',
        field: '--data',
        message: '--data is empty',
      } satisfies Partial<PageWriteError>);
    });
  });

  test('says there is no file when the source is inline JSON', async () => {
    await expect(readJsonInput('{"root":{}}', '--content')).rejects.toMatchObject({
      reason: 'invalid_input',
      field: '--content',
      message: '--content: no file {"root":{}}',
    } satisfies Partial<PageWriteError>);
  });
});
