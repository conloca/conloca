import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { defineFragmentComponents, evaluateMDXToComponent } from '@conloca/mdx/render';
import { type ReactNode, useId, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { islandVocabulary } from '../src/components/FragmentIsland.js';
import { initHydration } from '../src/lib/hydration-script.js';
import { withHydration } from '../src/lib/withHydration.js';

/** Records what an `IntersectionObserver` observes, and lets a test fire an intersection. */
class RecordingObserver implements IntersectionObserver {
  static instances: RecordingObserver[] = [];
  readonly root = null;
  readonly rootMargin = '0px';
  readonly scrollMargin = '0px';
  connected = true;
  readonly thresholds = [0];
  readonly targets: Element[] = [];
  constructor(readonly callback: IntersectionObserverCallback) {
    RecordingObserver.instances.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  unobserve() {}
  disconnect() {
    this.connected = false;
  }
  takeRecords() {
    return [];
  }
  fire(target: Element) {
    if (!this.connected) return;
    const rect = target.getBoundingClientRect();
    const entry = {
      boundingClientRect: rect,
      intersectionRatio: 1,
      intersectionRect: rect,
      isIntersecting: true,
      rootBounds: null,
      target,
      time: 0,
    };
    this.callback([entry], this);
  }
}

const realObserver = globalThis.IntersectionObserver;
afterEach(() => {
  globalThis.IntersectionObserver = realObserver;
  RecordingObserver.instances = [];
  document.body.innerHTML = '';
});

const Grid = () => (
  <section>
    <b>grid</b>
  </section>
);

describe('visible hydration', () => {
  test('visible observes children: the first element child, never the display:contents wrapper', async () => {
    globalThis.IntersectionObserver = RecordingObserver;
    document.body.innerHTML =
      '<div data-hydrate="Grid" data-props="{}" style="display:contents"><section><b>grid</b></section></div>';
    let loads = 0;
    initHydration({
      Grid: {
        loader: async () => {
          loads++;
          return Grid;
        },
        strategy: 'visible',
      },
    });
    const [observer] = RecordingObserver.instances;
    const target = document.querySelector('[data-hydrate]')?.firstElementChild;
    if (!observer || !target) throw new Error('test fixture invariant: an observer and a child exist');
    expect(observer.targets).toEqual([target]);
    observer.fire(target);
    observer.fire(target);
    await settle();
    expect(loads).toBe(1);
  });
});

// Fresh function objects: withHydration mutates the function it is given.
const Counter = withHydration(({ start, children }: { start: number; children?: ReactNode }) => {
  const [n, setN] = useState(start);
  return (
    <div>
      <button type="button" onClick={() => setN(n + 1)}>
        {n}
      </button>
      {children}
    </div>
  );
}, 'load');
const Tip = withHydration(({ children }: { children?: ReactNode }) => <span>{children}</span>, 'idle');
const Hidden = withHydration(({ children }: { children?: ReactNode }) => {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      {open && children}
    </div>
  );
}, 'load');
// Renders its useId as text too, so a re-render after a click shows the id the client root computed.
const Labelled = withHydration(() => {
  const id = useId();
  const [n, setN] = useState(0);
  return (
    <button type="button" id={id} aria-controls={`${id}-panel`} onClick={() => setN(n + 1)}>
      {`${id}|${n}`}
    </button>
  );
}, 'load');
const Seen = withHydration(() => <i>seen</i>, 'visible');
const keys = new Map<unknown, string>([
  [Counter, 'Counter'],
  [Tip, 'Tip'],
  [Hidden, 'Hidden'],
  [Labelled, 'Labelled'],
  [Seen, 'Seen'],
]);
const vocabulary = islandVocabulary(
  defineFragmentComponents({ components: { Counter, Tip, Hidden, Labelled, Seen } }),
  keys,
);

/** Puts the server render of `mdx` on the page, as a published page carries it. */
async function serve(mdx: string): Promise<void> {
  const { Component, error } = await evaluateMDXToComponent(mdx, vocabulary);
  if (error || !Component) throw error ?? new Error('no component');
  document.body.innerHTML = renderToStaticMarkup(<Component />);
}

/** Lets loaders resolve and React commit. */
const settle = () => Bun.sleep(10);

/** Polls until `ready` holds; fails naming `what` once `timeoutMs` passed. */
function waitFor(what: string, ready: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  // A throw inside a timer callback would escape the promise and leave the test hanging, so it rejects instead.
  const poll = () => {
    try {
      if (ready()) resolve();
      else if (Date.now() > deadline) reject(new Error(`timed out after ${timeoutMs}ms waiting for ${what}`));
      else setTimeout(poll, 5);
    } catch (error) {
      reject(error);
    }
  };
  poll();
  return promise;
}

/** Runs `body` and returns what `console.error` and window error events reported meanwhile. */
async function errorsDuring(body: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const log = spyOn(console, 'error').mockImplementation((...args: unknown[]) => seen.push(args));
  const onError = (event: ErrorEvent) => seen.push(event.error);
  window.addEventListener('error', onError);
  try {
    await body();
  } finally {
    window.removeEventListener('error', onError);
    log.mockRestore();
  }
  return seen;
}

const button = (index = 0) => {
  const found = document.querySelectorAll('button')[index];
  if (!found) throw new Error(`test fixture invariant: no button ${index}`);
  return found;
};

/** Clicks button `index` once React owns it (hydration attaches its fiber to the node), then waits until `done` holds. */
async function clickThen(index: number, what: string, done: () => boolean): Promise<void> {
  await waitFor(`button ${index} to hydrate`, () =>
    Object.keys(button(index)).some((key) => key.startsWith('__reactFiber$')),
  );
  button(index).click();
  await waitFor(what, done);
}

describe('fragment islands in the browser', () => {
  test('hydrates and keeps the slot', async () => {
    await serve('<Counter start={2}>\n\nCount **this**\n\n</Counter>');
    const strong = document.querySelector('strong');
    const errors = await errorsDuring(async () => {
      initHydration({}, { Counter: async () => Counter });
      await clickThen(0, 'the count to reach 3', () => button().textContent === '3');
    });
    expect(button().textContent).toBe('3');
    expect(document.querySelector('strong')).toBe(strong);
    expect(errors).toEqual([]);
  });

  test("the component's own useId matches the server", async () => {
    await serve('<Labelled />');
    const serverId = button().id;
    const island = document.querySelector<HTMLElement>('conloca-island')?.dataset.conlocaIsland ?? '';
    expect(serverId).toContain(island);
    let loads = 0;
    const errors = await errorsDuring(async () => {
      initHydration(
        {},
        {
          Labelled: async () => {
            loads++;
            return Labelled;
          },
        },
      );
      await clickThen(0, 'the client render to show the server id', () => button().textContent === `${serverId}|1`);
    });
    expect(loads).toBe(1);
    expect(button().textContent).toBe(`${serverId}|1`);
    expect(button().id).toBe(serverId);
    expect(errors).toEqual([]);
  });

  test('children the server kept hidden come from the template', async () => {
    await serve('<Hidden>\n\nSecret\n\n</Hidden>');
    initHydration({}, { Hidden: async () => Hidden });
    await clickThen(0, 'the hidden children to open', () =>
      (document.querySelector('conloca-island')?.innerHTML ?? '').includes('<p>Secret</p>'),
    );
    expect(document.querySelector('conloca-island')?.innerHTML).toContain('<p>Secret</p>');
  });

  test('nested islands hydrate on their own', async () => {
    await serve('<Counter start={1}>\n\n<Counter start={10} />\n\n</Counter>');
    const errors = await errorsDuring(async () => {
      initHydration({}, { Counter: async () => Counter });
      await clickThen(1, 'the nested count to reach 11', () => button(1).textContent === '11');
    });
    expect([button(0).textContent, button(1).textContent]).toEqual(['1', '11']);
    expect(errors).toEqual([]);
  });

  test('an unknown key warns, and the other islands still hydrate', async () => {
    await serve('<Tip>x</Tip>\n\n<Counter start={2} />');
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      initHydration({}, { Counter: async () => Counter });
      await settle();
      expect(warn).toHaveBeenCalledWith('[Conloca Hydration] Unknown fragment component: Tip');
    } finally {
      warn.mockRestore();
    }
    await clickThen(0, 'the count to reach 3', () => button().textContent === '3');
    expect(button().textContent).toBe('3');
  });

  test('only the marked islands load, once per key', async () => {
    await serve('<Counter start={1} />\n\n<Counter start={2} />');
    let counterLoads = 0;
    let tipLoads = 0;
    initHydration(
      {},
      {
        Counter: async () => {
          counterLoads++;
          return Counter;
        },
        Tip: async () => {
          tipLoads++;
          return Tip;
        },
      },
    );
    await settle();
    expect([counterLoads, tipLoads]).toEqual([1, 0]);
  });

  test('a page with no islands loads no fragment component', async () => {
    document.body.innerHTML = '<div data-hydrate="Grid" data-props="{}"><section><b>grid</b></section></div>';
    let loads = 0;
    initHydration(
      { Grid: { loader: async () => Grid, strategy: 'load' } },
      {
        Counter: async () => {
          loads++;
          return Counter;
        },
      },
    );
    await settle();
    expect(loads).toBe(0);
  });

  test('a visible island observes its first element child', async () => {
    globalThis.IntersectionObserver = RecordingObserver;
    await serve('<Seen />');
    initHydration({}, { Seen: async () => Seen });
    const target = document.querySelector('conloca-island')?.firstElementChild;
    if (!target) throw new Error('test fixture invariant: the island has an element child');
    expect(RecordingObserver.instances[0]?.targets).toEqual([target]);
  });
});
