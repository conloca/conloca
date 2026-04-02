import type { ReactNode } from 'react';

type NodeType = 'root' | 'p' | 'a' | 'code' | 'strong' | 'em' | 'span' | 'br';

type RichTextNode = {
  type: NodeType;
  attrs?: Record<string, string>;
  children: Array<RichTextNode | string>;
};

const allowedTags = new Set<NodeType>(['p', 'a', 'code', 'strong', 'em', 'span', 'br']);

function decodeEntities(value: string) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function parseAttributes(source: string) {
  const attrs: Record<string, string> = {};

  for (const match of source.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
    attrs[match[1]] = decodeEntities(match[2]);
  }

  return attrs;
}

function parseLimitedHtml(source: string) {
  const root: RichTextNode = { type: 'root', children: [] };
  const stack: RichTextNode[] = [root];
  const tagPattern = /<\/?[a-zA-Z][^>]*>|[^<]+/g;

  for (const token of source.match(tagPattern) || []) {
    const current = stack[stack.length - 1];

    if (!token.startsWith('<')) {
      current.children.push(decodeEntities(token));
      continue;
    }

    const closingMatch = token.match(/^<\/\s*([a-zA-Z]+)\s*>$/);
    if (closingMatch) {
      const tagName = closingMatch[1].toLowerCase() as NodeType;
      if (allowedTags.has(tagName)) {
        while (stack.length > 1) {
          const node = stack.pop();
          if (node?.type === tagName) {
            break;
          }
        }
      }
      continue;
    }

    const openingMatch = token.match(/^<\s*([a-zA-Z]+)([^>]*)\/?\s*>$/);
    if (!openingMatch) {
      current.children.push(token);
      continue;
    }

    const tagName = openingMatch[1].toLowerCase() as NodeType;
    const attrSource = openingMatch[2] || '';
    const selfClosing = token.endsWith('/>') || tagName === 'br';

    if (!allowedTags.has(tagName)) {
      continue;
    }

    const node: RichTextNode = {
      type: tagName,
      attrs: parseAttributes(attrSource),
      children: [],
    };

    current.children.push(node);

    if (!selfClosing) {
      stack.push(node);
    }
  }

  return root.children;
}

function renderNode(node: RichTextNode | string, key: string): ReactNode {
  if (typeof node === 'string') {
    return node;
  }

  const children = node.children.map((child, index) => renderNode(child, `${key}-${index}`));

  if (node.type === 'p') {
    return <p key={key}>{children}</p>;
  }

  if (node.type === 'a') {
    const href = node.attrs?.href || '#';
    return (
      <a key={key} href={href}>
        {children}
      </a>
    );
  }

  if (node.type === 'code') {
    return <code key={key}>{children}</code>;
  }

  if (node.type === 'strong') {
    return <strong key={key}>{children}</strong>;
  }

  if (node.type === 'em') {
    return <em key={key}>{children}</em>;
  }

  if (node.type === 'br') {
    return <br key={key} />;
  }

  return <span key={key}>{children}</span>;
}

export function renderLimitedRichText(source: string, wrapperClassName: string) {
  const nodes = parseLimitedHtml(source);
  const hasParagraph = nodes.some((node) => typeof node !== 'string' && node.type === 'p');

  if (hasParagraph) {
    return <div className={wrapperClassName}>{nodes.map((node, index) => renderNode(node, `${index}`))}</div>;
  }

  return (
    <div className={wrapperClassName}>
      <p>{nodes.map((node, index) => renderNode(node, `${index}`))}</p>
    </div>
  );
}
