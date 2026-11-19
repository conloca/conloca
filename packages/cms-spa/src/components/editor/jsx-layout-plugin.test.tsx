/// <reference lib="dom" />
import { afterEach, expect, test } from 'bun:test';
import {
  GenericJsxEditor,
  type JsxComponentDescriptor,
  jsxPlugin,
  MDXEditor,
  type MDXEditorMethods,
  realmPlugin,
  rootEditor$,
} from '@mdxeditor/editor';
import { cleanup, render } from '@testing-library/react';
import { $getRoot, type LexicalEditor, type LexicalNode } from 'lexical';
import { createRef } from 'react';
import { jsxLayoutPlugin } from './jsx-layout-plugin.js';

afterEach(cleanup);

interface JsxNode {
  getMdastNode(): { name: string | null };
  setMdastNode(node: { name: string | null }): void;
}

const isJsxNode = (node: LexicalNode): node is LexicalNode & JsxNode =>
  node.getType() === 'jsx' && 'setMdastNode' in node;

test('a renamed component block is written with its new name on both tags', async () => {
  const ref = createRef<MDXEditorMethods>();
  const root = Promise.withResolvers<LexicalEditor | null>();
  const plugins = [
    jsxPlugin({
      jsxComponentDescriptors: ['Callout', 'Unknown'].map(
        (name): JsxComponentDescriptor => ({
          name,
          kind: 'flow',
          props: [],
          hasChildren: true,
          Editor: GenericJsxEditor,
        }),
      ),
    }),
    jsxLayoutPlugin(),
    realmPlugin({ postInit: (realm) => root.resolve(realm.getValue(rootEditor$)) })(),
  ];
  render(<MDXEditor ref={ref} markdown={'<Callout>\n\nHello\n\n</Callout>\n'} plugins={plugins} />);
  const editor = await root.promise;
  expect(editor).not.toBeNull();
  editor?.update(
    () => {
      for (const node of $getRoot().getChildren()) {
        if (isJsxNode(node)) node.setMdastNode({ ...node.getMdastNode(), name: 'Unknown' });
      }
    },
    { discrete: true },
  );
  expect(ref.current?.getMarkdown()).toBe('<Unknown>\n\nHello\n\n</Unknown>');
});
