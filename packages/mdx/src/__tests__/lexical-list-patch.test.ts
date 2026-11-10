import { describe, expect, test } from 'bun:test';
import { $createListNode, ListItemNode, ListNode } from '@lexical/list';
import { $getRoot, $setState, createEditor } from 'lexical';
import { listMarkerState } from '../markdown-fidelity/list-markers.js';

/** Root child count after appending two adjacent bullet lists; the ListNode transform merges them unless the patch keeps them apart. */
function listsAfterMerge(firstMarker: string, secondMarker: string): number {
  const editor = createEditor({
    nodes: [ListNode, ListItemNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      for (const marker of [firstMarker, secondMarker]) {
        const list = $createListNode('bullet');
        $setState(list, listMarkerState, marker);
        $getRoot().append(list);
      }
    },
    { discrete: true },
  );
  return editor.getEditorState().read(() => $getRoot().getChildrenSize());
}

// patches/@lexical%2Flist@0.48.0.patch reads the marker through Lexical internals
// (node.getLatest().__state.sharedNodeState.sharedConfigMap). If a Lexical upgrade renames them, this fails:
// a throw from the transform, or lists that merge again. Re-check the patch then.
describe('the @lexical/list marker patch against Lexical internals', () => {
  test('keeps adjacent lists with different markers apart', () => {
    expect(listsAfterMerge('*', '-')).toBe(2);
  });
  test('still merges adjacent lists with the same marker', () => {
    expect(listsAfterMerge('-', '-')).toBe(1);
  });
});
