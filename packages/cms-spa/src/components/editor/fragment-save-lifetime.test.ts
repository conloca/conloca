import { expect, test } from 'bun:test';
import { ContentAPIClient } from '@conloca/content-api-client';
import fc from 'fast-check';
import { pendingFragmentSave, trackFragmentSave } from './fragment-save-lifetime.js';

type Model = { pending: number[] };
type Request = ReturnType<typeof Promise.withResolvers<void>>;
type Scope = { client: ContentAPIClient; id: string; locale: string; requests: Request[] };
type Real = { scopes: Scope[] };

class SaveLifetimeCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    readonly scope: number,
    readonly action: 'start' | 'resolve' | 'reject',
    readonly order: number,
  ) {}

  check(model: Readonly<Model>) {
    return this.action === 'start' || (model.pending[this.scope] ?? 0) > 0;
  }

  async run(model: Model, real: Real) {
    const scope = real.scopes[this.scope];
    if (!scope) throw new Error('Missing scope.');
    if (this.action === 'start') {
      const request = Promise.withResolvers<void>();
      scope.requests.push(request);
      void trackFragmentSave(scope.client, scope.id, scope.locale, request.promise);
      model.pending[this.scope] = (model.pending[this.scope] ?? 0) + 1;
    } else {
      const request = scope.requests.splice(this.order % scope.requests.length, 1)[0];
      if (!request) throw new Error('Missing pending request.');
      if (this.action === 'reject') request.reject(new Error('Refused write.'));
      else request.resolve();
      await request.promise.catch(() => {});
      model.pending[this.scope] = (model.pending[this.scope] ?? 0) - 1;
    }
    await Promise.all(
      real.scopes.map(async (candidate, index) => {
        const pending = pendingFragmentSave(candidate.client, candidate.id, candidate.locale);
        if (model.pending[index] === 0) {
          expect(pending).toBeNull();
          return;
        }
        expect(pending).not.toBeNull();
        let ready = false;
        void pending?.then(() => {
          ready = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(ready).toBe(false);
      }),
    );
  }

  toString() {
    return `${this.action} scope ${this.scope} order ${this.order}`;
  }
}

test('reopening remains blocked by every unfinished write in its own client, fragment and locale', async () => {
  const commands = fc.commands(
    [
      fc
        .tuple(
          fc.integer({ min: 0, max: 3 }),
          fc.constantFrom('start' as const, 'resolve' as const, 'reject' as const),
          fc.nat(8),
        )
        .map(([scope, action, order]) => new SaveLifetimeCommand(scope, action, order)),
    ],
    { maxCommands: 30 },
  );
  await fc.assert(
    fc.asyncProperty(commands, async (generated) => {
      const client = new ContentAPIClient();
      const otherClient = new ContentAPIClient();
      const scopes: Scope[] = [
        { client, id: 'footer', locale: 'en', requests: [] },
        { client, id: 'footer', locale: 'nl', requests: [] },
        { client, id: 'header', locale: 'en', requests: [] },
        { client: otherClient, id: 'footer', locale: 'en', requests: [] },
      ];
      try {
        await fc.asyncModelRun(() => ({ model: { pending: [0, 0, 0, 0] }, real: { scopes } }), generated);
      } finally {
        const requests = scopes.flatMap((scope) => scope.requests);
        requests.forEach((request) => {
          request.resolve();
        });
        await Promise.allSettled(requests.map((request) => request.promise));
      }
    }),
    { numRuns: 50 },
  );
});

test('a captured wait remains pending after one of two earlier writes settles', async () => {
  const client = new ContentAPIClient();
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  void trackFragmentSave(client, 'footer', 'en', first.promise);
  const returned = trackFragmentSave(client, 'footer', 'en', second.promise);
  expect(returned).toBe(second.promise);
  const waiting = pendingFragmentSave(client, 'footer', 'en');
  if (!waiting) throw new Error('The two writes must have an active wait.');
  let finished = false;
  void waiting.then(() => {
    finished = true;
  });
  try {
    first.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(finished).toBe(false);
    second.reject(new Error('Second write refused.'));
    await waiting;
    await expect(returned).rejects.toThrow('Second write refused.');
    expect(finished).toBe(true);
    expect(pendingFragmentSave(client, 'footer', 'en')).toBeNull();
  } finally {
    first.resolve();
    second.resolve();
    await waiting;
  }
});
