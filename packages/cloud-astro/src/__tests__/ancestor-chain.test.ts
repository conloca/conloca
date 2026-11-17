import { describe, expect, it } from 'bun:test';
import { ancestorChain } from '../doctor/ancestor-chain.js';

const ARTICLE_BODY_ROW =
  '<html><head><title>x</title></head><body><div class="page-wrapper b a"><main class="page-shell"><div data-conloca-page-root><div class="article-body"><article class="article-content"><div class="mdx-content conloca-prose" data-conloca-content-root><p>Hi<br>there</p></div></article></div></div></main></div></body></html>';

describe('ancestorChain', () => {
  it('reads the elements between <body> and the page-root marker, classes sorted', () => {
    expect(ancestorChain(ARTICLE_BODY_ROW)).toEqual([
      { tag: 'div', classes: ['a', 'b', 'page-wrapper'] },
      { tag: 'main', classes: ['page-shell'] },
    ]);
  });

  it('skips closed siblings, void elements and templates', () => {
    expect(
      ancestorChain(
        '<body><header class="h"><img src="x"><nav>n</nav></header><template><div data-conloca-page-root></div></template><main><div data-conloca-page-root></div></main></body>',
      ),
    ).toEqual([{ tag: 'main', classes: [] }]);
  });

  it('is undefined with no marker', () => {
    expect(ancestorChain('<body><main class="page-shell"></main></body>')).toBeUndefined();
  });

  it('ignores a script whose text names the marker', () => {
    expect(
      ancestorChain('<body><script>document.write("<div data-conloca-page-root></div>")</script><main></main></body>'),
    ).toBeUndefined();
  });
});
