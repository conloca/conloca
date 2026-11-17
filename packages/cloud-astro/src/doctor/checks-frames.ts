import { isRecord } from '@conloca/content-api/component-vocabulary';
import { EDITOR_PAGE_PATH } from '@conloca/content-api/editor-host';
import { type AncestorElement, ancestorChain, formatChain } from './ancestor-chain.js';
import { type LiveInput, request } from './request.js';
import { type CheckOutcome, outcomeOf, skipped } from './types.js';

const NO_FRAMES = 'no routing entry declares an editor frame';

function isAncestorElement(value: unknown): value is AncestorElement {
  return (
    isRecord(value) &&
    typeof value.tag === 'string' &&
    Array.isArray(value.classes) &&
    value.classes.every((c) => typeof c === 'string')
  );
}

/** A frames.json entry this check can read; anything else is dropped. */
function framedEntries(value: unknown): { route: string; pathname: string; chain: string }[] {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries)) return [];
  return value.entries.flatMap((entry: unknown) =>
    isRecord(entry) &&
    typeof entry.route === 'string' &&
    typeof entry.pathname === 'string' &&
    entry.pathname.startsWith('/') &&
    Array.isArray(entry.chain) &&
    entry.chain.every(isAncestorElement)
      ? [{ route: entry.route, pathname: entry.pathname, chain: formatChain(entry.chain) }]
      : [],
  );
}

/** CC30 — each framed route's published page still sits in the elements its editor frame renders. Only warns. */
export async function checkEditorFrames(input: LiveInput, address: string): Promise<CheckOutcome> {
  const fetchFn = input.deps.fetch;
  const answer = await request(fetchFn, `${address}${EDITOR_PAGE_PATH.slice(1)}frames.json`);
  let file: unknown;
  if (!(answer instanceof Error) && answer.status === 200) {
    try {
      file = await answer.json();
    } catch {
      file = undefined;
    }
  } else if (!(answer instanceof Error)) {
    await answer.body?.cancel().catch(() => {});
  }
  const entries = framedEntries(file);
  if (entries.length === 0) return skipped('CC30', NO_FRAMES);
  const outcome = outcomeOf('CC30');
  const warn = (message: string) => outcome.problems.push({ check: 'CC30', level: 'warn', message });
  // One page at a time: the doctor keeps its load on a live site to a single request.
  /* oxlint-disable no-await-in-loop -- see above. */
  for (const { route, pathname, chain } of entries) {
    const url = `${address}${pathname.slice(1)}`;
    const page = await request(fetchFn, url);
    if (page instanceof Error) {
      warn(`${url} could not be reached (${page.message})`);
      continue;
    }
    if (page.status >= 300 && page.status < 400) {
      await page.body?.cancel().catch(() => {});
      warn(
        `${url} redirects to ${page.headers.get('location') ?? 'nowhere'}, so the frame of ${route} cannot be compared`,
      );
      continue;
    }
    if (!page.ok) {
      await page.body?.cancel().catch(() => {});
      warn(`${url} answered HTTP ${page.status}, so the frame of ${route} cannot be compared`);
      continue;
    }
    const found = ancestorChain(await page.text());
    if (found === undefined) {
      warn(
        `${url} lacks data-conloca-page-root, so the frame of ${route} cannot be compared (an old build, or a page another handler serves)`,
      );
      continue;
    }
    const actual = formatChain(found);
    if (actual !== chain) warn(`${route} (${pathname}): the frame renders ${chain} but the page has ${actual}`);
  }
  /* oxlint-enable no-await-in-loop */
  return outcome;
}
