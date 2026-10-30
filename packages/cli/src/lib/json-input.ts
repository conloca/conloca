import { readFile } from 'node:fs/promises';
import { text } from 'node:stream/consumers';
import { messageOf } from './message-of.js';
import { PageWriteError } from './page-write.js';

/**
 * Read the JSON a flag points at: '-' reads stdin to the end, anything else is
 * a file path. Inline JSON is not accepted; pass a file or pipe into '-'.
 * Every refusal names `flag`, so the message points at what to fix.
 */
export async function readJsonInput(source: string, flag: string): Promise<unknown> {
  const input =
    source === '-'
      ? await text(process.stdin)
      : await readFile(source, 'utf-8').catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') throw new PageWriteError('invalid_input', `${flag}: no file ${source}`, flag);
          throw error;
        });
  if (input.trim() === '') throw new PageWriteError('invalid_input', `${flag} is empty`, flag);
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new PageWriteError('invalid_input', `${flag} is not JSON: ${messageOf(error)}`, flag);
  }
}
