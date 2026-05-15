import type { JsxEditorProps } from '@mdxeditor/editor';
import { NestedLexicalEditor, useLexicalNodeRemove } from '@mdxeditor/editor';
import { FolderTree, Trash2 } from 'lucide-react';
import type * as Mdast from 'mdast';
import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx';

/**
 * Editor for Starlight `<FileTree>` — wraps a markdown list and renders
 * it as a monospaced directory tree.
 *
 * Pattern A drift: on the published page Starlight's `rehype-file-tree`
 * processes the slot HTML, decorating `<li>` items with `.directory` /
 * `.file` classes, inlining `<details>`/`<summary>` chrome, drawing
 * `<svg>` tree icons. None of that runs in the editor — the rehype pass
 * is server-side. The editor mirrors the published frame chrome (border,
 * dark bg, monospace font, padding) via CSS targeting the unclassed
 * inner `<ul>` so the silhouette reads right; the inner items show as a
 * plain nested list without folder/file icons or collapse toggles.
 *
 * FileTree has no props beyond children — descriptor surfaces just the
 * remove button + tree label.
 */
export function FileTreeEditor({ mdastNode: _mdastNode }: JsxEditorProps) {
  const removeNode = useLexicalNodeRemove();
  return (
    <div className="conloca-file-tree-editor" contentEditable={false}>
      <div className="conloca-file-tree__chip">
        <FolderTree className="conloca-file-tree__chip-icon" size={14} aria-hidden focusable={false} />
        <span className="conloca-file-tree__chip-label">FileTree</span>
        <button
          type="button"
          onClick={removeNode}
          aria-label="Remove file tree"
          title="Remove file tree"
          className="conloca-file-tree__remove"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
      <div className="conloca-file-tree">
        <NestedLexicalEditor<MdxJsxFlowElement>
          getContent={(n) => n.children as Mdast.PhrasingContent[]}
          getUpdatedMdastNode={(n, children) => ({
            ...n,
            children: children as MdxJsxFlowElement['children'],
          })}
        />
      </div>
    </div>
  );
}
