/// <reference lib="dom" />
import { describe, expect, mock, test } from 'bun:test';
import { render } from '@testing-library/react';
import { ContentSandbox } from './ContentSandbox.js';

describe('ContentSandbox', () => {
  test('takes messages only from its own frame, even when they carry its key', () => {
    const onLinkClick = mock((_href: string) => {});
    const { container } = render(<ContentSandbox mode="html" content="<p>x</p>" onLinkClick={onLinkClick} />);
    const frame = container.querySelector('iframe');
    if (!frame) throw new Error('no sandbox frame rendered');
    const link = (source: MessageEventSource | null) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { __conlocaSandbox: true, k: frame.dataset.sandboxK, kind: 'link', href: '/next' },
          source,
        }),
      );

    link(window);
    link(null);
    expect(onLinkClick).not.toHaveBeenCalled();

    link(frame.contentWindow);
    expect(onLinkClick).toHaveBeenCalledWith('/next');
  });
});
