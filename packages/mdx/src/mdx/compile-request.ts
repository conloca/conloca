import { ErrorCodes } from '@conloca/content-api';
import { compileMDX } from './compile.js';

/** Answers a compile request with the whole compile result, the one implementation every host mounts. */
export async function handleMDXCompileRequest(
  request: Request,
  options: { maxChars?: number } = {},
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: ErrorCodes.INVALID_REQUEST, message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  const mdxContent = typeof body === 'object' && body !== null && 'mdxContent' in body ? body.mdxContent : null;
  if (!mdxContent || typeof mdxContent !== 'string') {
    return Response.json(
      {
        error: {
          code: ErrorCodes.MISSING_REQUIRED_FIELD,
          message: 'mdxContent string required',
          details: { field: 'mdxContent' },
        },
      },
      { status: 400 },
    );
  }

  const { maxChars } = options;
  if (maxChars !== undefined && mdxContent.length > maxChars) {
    return Response.json(
      {
        error: {
          code: ErrorCodes.INVALID_REQUEST,
          message: `mdxContent exceeds size limit (${mdxContent.length} > ${maxChars} characters)`,
        },
      },
      { status: 413 },
    );
  }

  try {
    return Response.json(await compileMDX(mdxContent));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to compile MDX';
    console.error(`[CMS] ${new URL(request.url).pathname} failed:`, error);
    return Response.json({ error: { code: ErrorCodes.MDX_COMPILE_FAILED, message } }, { status: 422 });
  }
}
