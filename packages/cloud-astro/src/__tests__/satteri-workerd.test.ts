import { describe, expect, it } from 'bun:test';
import { htmlToHast } from '../preview/satteri-workerd.js';

describe('satteri stand-in for the Cloudflare Workers preview build — htmlToHast', () => {
  it('parses a fragment without wrapping it in html/head/body', () => {
    const tree = htmlToHast('<ol start="3"><li>a</li></ol>', { fragment: true });
    expect(tree.type).toBe('root');
    expect(tree.children).toHaveLength(1);
    const [list] = tree.children;
    expect(list.type === 'element' && list.tagName).toBe('ol');
    expect(list.type === 'element' && list.properties.start).toBe(3);
  });

  it('parses a whole document when fragment is not requested', () => {
    const tree = htmlToHast('<p>x</p>');
    const elementNames = tree.children.flatMap((child) => (child.type === 'element' ? [child.tagName] : []));
    expect(elementNames).toEqual(['html']);
  });

  // satteri parses SVG input in SVG context, where `<path/>` self-closes; as
  // plain HTML the second path would nest inside the first.
  it('parses SVG input in SVG context, so self-closing siblings stay siblings', () => {
    const tree = htmlToHast('<path d="M1"/><path d="M2"/>', { fragment: true, space: 'svg' });
    expect(tree.type).toBe('root');
    const paths = tree.children.map((child) =>
      child.type === 'element' ? { tagName: child.tagName, d: child.properties.d, children: child.children } : child,
    );
    expect(paths).toEqual([
      { tagName: 'path', d: 'M1', children: [] },
      { tagName: 'path', d: 'M2', children: [] },
    ]);
  });
});
