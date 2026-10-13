import { describe, expect, spyOn, test } from 'bun:test';
import { ErrorCodes } from '@conloca/content-api';
import { compileMDX } from '../mdx/compile.js';
import { handleMDXCompileRequest } from '../node.js';

/**
 * The compile route is the one way an editor turns MDX source into something
 * it can preview. Every host mounts this same handler, so these tests are the
 * route contract for all of them: what the editor gets back, and the error
 * bodies it already knows how to read.
 */

function compileRequest(body: string): Request {
  return new Request('http://cms.test/mdx/compile', { method: 'POST', body });
}

function compileRequestFor(mdxContent: unknown): Request {
  return compileRequest(JSON.stringify({ mdxContent }));
}

describe('MDX compile request', () => {
  test('answers with the whole compile result, including the outline the contents column reads', async () => {
    const res = await handleMDXCompileRequest(compileRequestFor('## A heading'));

    expect(res.status).toBe(200);
    const json = (await res.json()) as { outline: unknown };
    expect(json.outline).toEqual([{ depth: 2, id: 'a-heading', text: 'A heading' }]);
  });

  test('passes every field of the compile result through, not a hand-picked subset', async () => {
    const mdx = '---\ntitle: Fragment\n---\n\n## A heading';

    const res = await handleMDXCompileRequest(compileRequestFor(mdx));

    expect(await res.json()).toEqual({ ...(await compileMDX(mdx)) });
  });

  test('refuses a body that is not JSON', async () => {
    const res = await handleMDXCompileRequest(compileRequest('{'));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: ErrorCodes.INVALID_REQUEST, message: 'Invalid JSON body' } });
  });

  test.each([
    ['no mdxContent', {}],
    ['an mdxContent that is not a string', { mdxContent: 42 }],
    ['an empty mdxContent', { mdxContent: '' }],
    ['a JSON null body', null],
  ])('refuses a request with %s', async (_label, body) => {
    const res = await handleMDXCompileRequest(compileRequest(JSON.stringify(body)));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: ErrorCodes.MISSING_REQUIRED_FIELD,
        message: 'mdxContent string required',
        details: { field: 'mdxContent' },
      },
    });
  });

  test('reports MDX that does not compile as 422 with the compiler message', async () => {
    const logged = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await handleMDXCompileRequest(compileRequestFor('# Broken {'));

      expect(res.status).toBe(422);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe(ErrorCodes.MDX_COMPILE_FAILED);
      expect(json.error.message).toStartWith('MDX compilation failed:');
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  test('refuses source over the size cap a host sets, before compiling it', async () => {
    const res = await handleMDXCompileRequest(compileRequestFor('## A heading'), { maxChars: 5 });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: { code: ErrorCodes.INVALID_REQUEST, message: 'mdxContent exceeds size limit (12 > 5 characters)' },
    });
  });

  test('compiles source that is exactly at the size cap', async () => {
    const res = await handleMDXCompileRequest(compileRequestFor('## A heading'), { maxChars: 12 });

    expect(res.status).toBe(200);
  });
});
