import { describe, expect, it } from 'bun:test';
import { exchangeEntryCode } from '../preview/entry-code.js';
import { handlePreviewRequest } from '../preview/middleware.js';
import { grantRef, orgToken } from '../preview/redeem-url.js';

const input = {
  saasEndpoint: 'https://cms.example.test',
  code: 'Z2l0aHViOjc.secret',
  origin: 'https://site.test',
  repo: 'acme/site',
  siteId: 'website',
};

const answering = (answer: () => Response) => Object.assign(async () => answer(), { preconnect: fetch.preconnect });

describe('exchangeEntryCode', () => {
  it('posts the code with the origin, repository and site it opens, and returns the pass', async () => {
    const calls: { url: unknown; init?: RequestInit }[] = [];
    const record = async (url: unknown, init?: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ pass: 'header.pass.sig' });
    };
    const fetchFn = Object.assign(record, { preconnect: fetch.preconnect });
    expect(await exchangeEntryCode({ ...input, fetchFn })).toEqual({ ok: true, pass: 'header.pass.sig' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://cms.example.test/preview/exchange');
    expect(calls[0]?.init?.method).toBe('POST');
    const body = calls[0]?.init?.body;
    expect(typeof body === 'string' ? JSON.parse(body) : body).toEqual({
      code: 'Z2l0aHViOjc.secret',
      origin: 'https://site.test',
      repo: 'acme/site',
      siteId: 'website',
    });
  });

  it('answers unknown when Conloca does not know the code', async () => {
    const fetchFn = answering(() => Response.json({ error: 'code-unknown' }, { status: 404 }));
    expect(await exchangeEntryCode({ ...input, fetchFn })).toEqual({ ok: false, kind: 'unknown' });
  });

  it('answers ended with the verdict and sharer when the link has ended', async () => {
    const fetchFn = answering(() => Response.json({ error: 'draft-published', sharedBy: 'Ana' }, { status: 410 }));
    expect(await exchangeEntryCode({ ...input, fetchFn })).toEqual({
      ok: false,
      kind: 'ended',
      ended: { verdict: 'draft-published', sharedBy: 'Ana' },
    });
  });

  it.each([
    ['a 404 naming something else', () => Response.json({ error: 'nope' }, { status: 404 })],
    ['a 410 naming no ended kind', () => Response.json({ error: 'gone' }, { status: 410 })],
    ['a 403', () => Response.json({ error: 'origin-mismatch' }, { status: 403 })],
    ['a 429', () => Response.json({ error: 'rate-limited' }, { status: 429 })],
    ['a 503', () => new Response('down', { status: 503 })],
    ['a body without a pass', () => Response.json({ pass: 7 })],
    ['a body that is not JSON', () => new Response('<html>', { status: 200 })],
    [
      'a transport failure',
      () => {
        throw new TypeError('network down');
      },
    ],
  ])('answers unavailable on %s', async (_name, answer) => {
    expect(await exchangeEntryCode({ ...input, fetchFn: answering(answer) })).toEqual({
      ok: false,
      kind: 'unavailable',
    });
  });
});

describe('orgToken', () => {
  it('is the unpadded base64url of the org id, the same vector Conloca uses', () => {
    expect(orgToken('github:7')).toBe('Z2l0aHViOjc');
    expect(grantRef('github:7', 'AAAAAAAAAAAAAAAAAAAAAA')).toBe('Z2l0aHViOjc.AAAAAAAAAAAAAAAAAAAAAA');
  });
});

describe('handlePreviewRequest — the entry code shape', () => {
  it('never calls Conloca for a code that is not `<org token>.<secret>`', async () => {
    let calls = 0;
    const fetchFn = Object.assign(
      async () => {
        calls++;
        return Response.json({ pass: 'header.pass.sig' });
      },
      { preconnect: fetch.preconnect },
    );
    await Promise.all(
      ['x', 'a.b', 'Z2l0aHViOjd.abcdefghijklmnopqrstuv'].map((code) =>
        handlePreviewRequest(new Request(`https://site.test/_conloca/preview/blog?conloca_code=${code}`), {
          ...input,
          saasAudience: 'acme/site',
          branch: 'main',
          base: '/',
          fetchFn,
        }),
      ),
    );
    expect(calls).toBe(0);
  });
});
