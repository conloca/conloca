/**
 * The image endpoint a d8 draft page uses, at `<base>_conloca/preview/_image` on Vercel, Netlify and Node: it answers
 * with a redirect to the original image, so drafts get untransformed images and the site's own `/_image` stays as it
 * was. It never fetches: only a same-origin path or a host the site's `image` config allows is redirected to.
 */

import { imageConfig } from 'astro:assets';
import type { APIContext, APIRoute } from 'astro';
import { isRemoteAllowed } from 'astro/assets/utils';
import { applyPreviewHeaders } from './preview/headers.js';

export const GET = (({ url }: Pick<APIContext, 'url'>) => {
  const href = url.searchParams.get('href') ?? '';
  const target = URL.canParse(href, url.href) ? new URL(href, url) : null;
  // `//host` and `/\host` resolve off-origin, so the origin check catches them; decoded, `%5Fimage` is our own route.
  const local =
    href.startsWith('/') && target?.origin === url.origin && safeDecode(target.pathname) !== safeDecode(url.pathname);
  const remote = /^https?:\/\//iu.test(href) && isRemoteAllowed(href, imageConfig);
  try {
    // The Location comes from the parsed URL, so no raw input reaches the header.
    const location = local ? `${target.pathname}${target.search}` : remote && target ? target.href : null;
    if (location !== null) return applyPreviewHeaders(new Response(null, { status: 302, headers: { location } }));
  } catch {
    // An invalid header value: refused below.
  }
  return applyPreviewHeaders(new Response(null, { status: 403 }));
}) satisfies APIRoute;

function safeDecode(path: string): string | null {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}
