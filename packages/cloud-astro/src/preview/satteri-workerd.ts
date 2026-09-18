import { fromHtml } from 'hast-util-from-html';

/** The options satteri's `htmlToHast` accepts. */
export interface HtmlToHastOptions {
  fragment?: boolean;
  space?: 'html' | 'svg';
}

/**
 * Stands in for satteri's `htmlToHast` in the Cloudflare preview build:
 * satteri's Cloudflare Workers binding can be neither installed nor run on workerd, so
 * the preview build resolves bare `satteri` here instead. Only `htmlToHast`
 * exists on purpose — any other satteri import then fails the build loudly
 * rather than crashing at render time. SVG input is wrapped in `<svg>` because
 * satteri parses it in SVG context (a self-closing `<path/>` stays a sibling),
 * while `hast-util-from-html` would tokenize it as HTML and nest the elements.
 */
export function htmlToHast(html: string, options: HtmlToHastOptions = {}): ReturnType<typeof fromHtml> {
  if (options.space === 'svg') {
    const [svg] = fromHtml(`<svg>${html}</svg>`, { fragment: true }).children;
    return { type: 'root', children: svg?.type === 'element' ? svg.children : [] };
  }
  return fromHtml(html, { fragment: options.fragment, space: options.space });
}
