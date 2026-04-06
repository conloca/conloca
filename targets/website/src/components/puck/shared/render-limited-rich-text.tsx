import type { ReactNode } from 'react';

function decodeEntities(value: string) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function normalizeLegacyHtml(source: string) {
  return decodeEntities(source)
    .replaceAll(/<br\s*\/?>/gi, '\n')
    .replaceAll(/<\/p>\s*<p>/gi, '\n\n')
    .replaceAll(/<p>/gi, '')
    .replaceAll(/<\/p>/gi, '')
    .replaceAll(/<strong>(.*?)<\/strong>/gi, '**$1**')
    .replaceAll(/<em>(.*?)<\/em>/gi, '*$1*')
    .replaceAll(/<code[^>]*>(.*?)<\/code>/gi, (_match, value: string) => `\`${decodeEntities(value)}\``)
    .replaceAll(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_match, href: string, label: string) => {
      return `[${decodeEntities(label)}](${href})`;
    })
    .replaceAll(/<[^>]+>/g, '');
}

function renderInlineMarkdown(source: string) {
  const nodes: ReactNode[] = [];
  const pattern = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;

  for (const match of source.matchAll(pattern)) {
    const [token] = match;
    const start = match.index || 0;

    if (start > lastIndex) {
      nodes.push(source.slice(lastIndex, start));
    }

    if (token.startsWith('[')) {
      const tokenMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (tokenMatch) {
        nodes.push(
          <a key={`${start}-link`} href={tokenMatch[2]}>
            {tokenMatch[1]}
          </a>,
        );
      }
    } else if (token.startsWith('`')) {
      nodes.push(<code key={`${start}-code`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={`${start}-strong`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={`${start}-em`}>{token.slice(1, -1)}</em>);
    }

    lastIndex = start + token.length;
  }

  if (lastIndex < source.length) {
    nodes.push(source.slice(lastIndex));
  }

  return nodes;
}

export function renderLimitedRichText(source: string, wrapperClassName: string) {
  if (typeof source !== 'string') return <div className={wrapperClassName}>{source}</div>;
  const normalizedSource = normalizeLegacyHtml(source);
  const paragraphs = normalizedSource
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <div className={wrapperClassName}>
      {paragraphs.length > 0
        ? paragraphs.map((paragraph, i) => (
            <p key={i}>
              {paragraph.split('\n').flatMap((line, lineIndex, lines) => {
                const inlineNodes = renderInlineMarkdown(line);
                return lineIndex < lines.length - 1 ? [...inlineNodes, <br key={lineIndex} />] : inlineNodes;
              })}
            </p>
          ))
        : null}
    </div>
  );
}
