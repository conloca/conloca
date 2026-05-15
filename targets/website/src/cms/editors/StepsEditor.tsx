import type { JsxEditorProps } from '@mdxeditor/editor';
import { NestedLexicalEditor, useLexicalNodeRemove } from '@mdxeditor/editor';
import { Trash2 } from 'lucide-react';
import type * as Mdast from 'mdast';
import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx';

/**
 * Editor for Starlight `<Steps>` — wraps an ordered list and renders it
 * with a numbered-chip + vertical-guideline silhouette.
 *
 * On the published page, Starlight's `processSteps` rehype plugin adds
 * the `.sl-steps` class to the inner `<ol>`; the matching `.conloca-steps`
 * rules in `targets/website/src/styles/starlight-components.css` paint the
 * chip chrome. In the editor we don't run the rehype pass, so the inner
 * `<ol>` stays unclassed — instead we target it via the `.conloca-steps-
 * editor [class*="nestedEditor"] > ol` selector (declared alongside
 * `.conloca-steps` so the same chrome paints).
 *
 * Steps has no props beyond children, so this editor just wraps the
 * nested rich-text area + a remove button.
 */
export function StepsEditor({ mdastNode: _mdastNode }: JsxEditorProps) {
  const removeNode = useLexicalNodeRemove();
  return (
    <div className="conloca-steps-editor" contentEditable={false}>
      <button
        type="button"
        onClick={removeNode}
        aria-label="Remove steps block"
        title="Remove steps block"
        className="conloca-steps__remove"
      >
        <Trash2 size={14} aria-hidden />
      </button>
      <NestedLexicalEditor<MdxJsxFlowElement>
        getContent={(n) => n.children as Mdast.PhrasingContent[]}
        getUpdatedMdastNode={(n, children) => ({
          ...n,
          children: children as MdxJsxFlowElement['children'],
        })}
      />
    </div>
  );
}
