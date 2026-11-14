import type { Config, Data } from '@puckeditor/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { fn } from 'storybook/test';
import type {
  DiscardOutcome,
  DraftToolsHost,
  EarlierVersion,
  PageConflict,
  PageRef,
  ResolveConflictInput,
  ResolveConflictOutcome,
  RestoreVersionOutcome,
} from '../src/draft-tools.js';
import { configureUI, getUIConfig } from '../src/ui-config.js';
import { createFakeDocChannel, type FakeDocChannel } from './fake-doc-channel.js';

/** The page, editor and host the conflict stories share: one Hero block whose title clashes. */

export const PAGE: PageRef = { site: 'default', id: 'home', locale: 'en' };
const DAY = 86_400_000;

export const config: Config = {
  components: {
    Hero: {
      label: 'Hero',
      fields: { title: { type: 'text', label: 'Hero title' }, body: { type: 'richtext', label: 'Body' } },
      render: ({ title }) => <h1>{title}</h1>,
    },
  },
};

export const data: Data = {
  root: { props: {} },
  content: [{ type: 'Hero', props: { id: 'hero-1', title: 'Spring sale', body: { value: '<p>Hi</p>' } } }],
};

export function clash(over: Partial<PageConflict> = {}): PageConflict {
  return {
    anchor: 'content[id=hero-1].props.title',
    base: 'Sale',
    ours: 'Spring sale',
    theirs: 'Summer sale',
    valueId: 'v1',
    source: 'github',
    authorLabel: 'Ben',
    createdAt: Date.now() - 2 * DAY,
    ...over,
  };
}

/** A host whose conflicts list and answers the play sets; every call is recorded. */
export function fakeTools(lists: PageConflict[][], answers: ResolveConflictOutcome[] = []) {
  let call = 0;
  return {
    listConflicts: fn(async (_page: PageRef) => lists[Math.min(call++, lists.length - 1)] ?? []),
    resolveConflict: fn(
      async (_input: ResolveConflictInput): Promise<ResolveConflictOutcome> => answers.shift() ?? { ok: true },
    ),
    discardPage: fn(async (_page: PageRef): Promise<DiscardOutcome> => ({ ok: true })),
    listVersions: fn(async (_page: PageRef): Promise<EarlierVersion[]> => []),
    restoreVersion: fn(
      async (_input: { snapshotId: string }): Promise<RestoreVersionOutcome> => ({ ok: true, kept: [] }),
    ),
  } satisfies DraftToolsHost;
}

type FakeTools = ReturnType<typeof fakeTools>;
/** The current story's host and doc channel, set by {@link setUp}. */
export let tools: FakeTools;
export let fake: FakeDocChannel;

/** Installs the host's draft tools and a doc channel the play can fire live messages through. */
export function setUp(next: FakeTools) {
  return () => {
    const previous = getUIConfig();
    tools = next;
    fake = createFakeDocChannel({ puckData: data });
    configureUI({ ...previous, draftTools: tools, docChannel: fake.channel, siteId: PAGE.site });
    return () => configureUI(previous);
  };
}

export function WithQueries({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
