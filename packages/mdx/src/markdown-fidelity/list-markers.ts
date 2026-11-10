import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  ListItemNode,
  type ListNode,
} from '@lexical/list';
import type { LexicalExportVisitor, MdastImportVisitor } from '@mdxeditor/editor';
import {
  $getNodeByKey,
  $getState,
  $isDecoratorNode,
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
  $setState,
  createState,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import type * as Mdast from 'mdast';
import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown';
import { defaultHandlers, type Handle, type Join, type Options } from 'mdast-util-to-markdown';

declare module 'mdast' {
  interface ListData {
    /** The list's source marker: `*`, `+`, `-`, `.` or `)`. */
    marker?: string;
    /** This list continues the mdast list before it (a mixed task list split on import). */
    continues?: boolean;
  }
  interface ListItemData {
    /** A blank line precedes this item in the source; absent for items made in the editor. */
    blankBefore?: boolean;
    /** Whether a blank line precedes each block child after the first, as in the source. */
    gaps?: boolean[];
  }
}

/**
 * The list's source marker; `''` when unknown (lists made in the editor). This repo's `@lexical/list`
 * patch reads the value under this key to keep adjacent lists with different markers apart; without
 * the patch the lists merge as before and nothing breaks.
 */
export const listMarkerState = createState('mdListMarker', {
  parse: (value) => (typeof value === 'string' ? value : ''),
});

/** True when this Lexical list continues the mdast list before it: a list mixing task and plain items is split on import. */
export const listContinuesState = createState('mdListContinues', {
  parse: (value) => value === true,
});

/** On a ListNode: the mdast `list.spread` at import. */
export const listSpreadState = createState('mdListSpread', {
  parse: (value) => value === true,
});

/** On a ListItemNode: the mdast `listItem.spread` at import. */
export const listItemSpreadState = createState('mdItemSpread', {
  parse: (value) => value === true,
});

/** A blank line precedes this item in the source; `null` for items made in the editor. */
export const listItemBlankBeforeState = createState('mdItemBlankBefore', {
  parse: (value) => (typeof value === 'boolean' ? value : null),
});

/** On a ListItemNode: a blank line before each block child after the first, in source order; `null` when unknown. */
export const listItemGapsState = createState('mdItemGaps', {
  parse: (value) => (Array.isArray(value) && value.every((gap) => typeof gap === 'boolean') ? value : null),
});

/**
 * On a ListItemNode: it holds the item's paragraphs written after a nested list. A Lexical item cannot hold
 * text after a nested list, so these sit in an item of their own and write back into the item before them.
 * The value is the item's own key: Enter copies an item with its state, and the copy must stay a new item.
 */
const listItemContinuationState = createState('mdItemContinuation', {
  parse: (value) => (typeof value === 'string' ? value : null),
});

/** Marks a new item as holding the paragraphs after its previous item's nested list. */
export function $markContinuation(item: ListItemNode): ListItemNode {
  return $setState(item, listItemContinuationState, item.getKey());
}

export function $isContinuation(item: ListItemNode): boolean {
  return $getState(item, listItemContinuationState) === item.getKey();
}

/**
 * Marks continuation items in the DOM; editor-styles.css hides their bullet, number and checkbox, since they
 * are not list items of their own (a check toggled there would be dropped on save).
 */
export function registerContinuationClass(editor: LexicalEditor): () => void {
  return editor.registerMutationListener(ListItemNode, (mutations) => {
    editor.getEditorState().read(() => {
      for (const [key, mutation] of mutations) {
        if (mutation === 'destroyed') continue;
        const node = $getNodeByKey(key);
        const isContinuation = $isListItemNode(node) && $isContinuation(node);
        editor.getElementByKey(key)?.classList.toggle('conloca-md-continuation', isContinuation);
      }
    });
  });
}

/**
 * The source's blank lines between an item's block children, in the shape the item exports to: its
 * consecutive paragraphs become one (joined by line breaks).
 */
function itemGaps(children: Mdast.ListItem['children']): boolean[] | null {
  const gaps: boolean[] = [];
  for (let index = 1; index < children.length; index++) {
    const left = children[index - 1];
    const right = children[index];
    if (left?.type === 'paragraph' && right?.type === 'paragraph') continue;
    const leftEnd = left?.position?.end.line;
    const rightStart = right?.position?.start.line;
    if (leftEnd === undefined || rightStart === undefined) return null;
    gaps.push(rightStart - leftEnd > 1);
  }
  return gaps;
}

/** An item stored after an item to hold its nested list, or its paragraphs after a nested list. */
const isItemFollower = (node: LexicalNode | null): node is ListItemNode =>
  $isListItemNode(node) &&
  ($isContinuation(node) || (node.getChildrenSize() === 1 && $isListNode(node.getFirstChild())));

/** The last of the items stored after `item` for its nested lists and later paragraphs, or `item` itself. */
export function $lastItemFollower(item: ListItemNode): ListItemNode {
  let last = item;
  for (let next = last.getNextSibling(); isItemFollower(next); next = last.getNextSibling()) last = next;
  return last;
}

/**
 * Where an item's block child goes: the item itself, or, after the item's first nested list, a continuation
 * item after the nested lists (new, unless a nested list came between).
 */
function $childTarget(item: ListItemNode, children: Mdast.ListItem['children'], index: number): ListItemNode {
  if (children[index]?.type === 'list' || !children.slice(0, index).some((child) => child.type === 'list')) return item;
  const last = $lastItemFollower(item);
  if ($isContinuation(last) && children[index - 1]?.type !== 'list') return last;
  const continuation = $markContinuation($createListItemNode());
  last.insertAfter(continuation);
  return continuation;
}

/** Records each list's marker; mdast has no field for it. */
export const listMarkerFromMarkdown: FromMarkdownExtension = {
  exit: {
    listItemMarker(token) {
      for (let index = this.stack.length - 1; index >= 0; index--) {
        const node = this.stack[index];
        if (node?.type !== 'list') continue;
        node.data ??= {};
        node.data.marker ??= this.sliceSerialize(token);
        return;
      }
    },
  },
};

const isTaskItem = (item: Mdast.ListItem) => typeof item.checked === 'boolean';

/** Splits items into runs of task items and plain items; a Lexical list cannot mix the two. */
function itemRuns(items: Mdast.ListItem[]): Mdast.ListItem[][] {
  const runs: Mdast.ListItem[][] = [];
  for (const item of items) {
    const run = runs[runs.length - 1];
    if (run?.[0] !== undefined && isTaskItem(run[0]) === isTaskItem(item)) run.push(item);
    else runs.push([item]);
  }
  return runs;
}

/**
 * The stock list visitor, plus the source marker and looseness, and a mixed task list split into
 * one Lexical list per run so plain items gain no checkbox.
 */
export const MdastMarkedListVisitor: MdastImportVisitor<Mdast.List> = {
  testNode: 'list',
  priority: 10,
  visitNode({ mdastNode, lexicalParent, actions }) {
    mdastNode.children.forEach((item, index) => {
      const previousEnd = mdastNode.children[index - 1]?.position?.end.line;
      const start = item.position?.start.line;
      if (previousEnd === undefined || start === undefined) return;
      item.data = { ...item.data, blankBefore: start - previousEnd > 1 };
    });
    for (const [index, run] of itemRuns(mdastNode.children).entries()) {
      const listNode = $createListNode(run.some(isTaskItem) ? 'check' : mdastNode.ordered ? 'number' : 'bullet');
      $setState(listNode, listMarkerState, mdastNode.data?.marker ?? '');
      $setState(listNode, listSpreadState, mdastNode.spread === true);
      if (index > 0) $setState(listNode, listContinuesState, true);
      if ($isListItemNode(lexicalParent)) {
        const dedicatedParent = $createListItemNode();
        dedicatedParent.append(listNode);
        // Go past the nested lists and paragraphs this item already holds, so they keep their order.
        $lastItemFollower(lexicalParent).insertAfter(dedicatedParent);
      } else if ($isElementNode(lexicalParent)) {
        lexicalParent.append(listNode);
      } else {
        throw new Error(`a list inside ${lexicalParent.getType()}`);
      }
      actions.visitChildren({ ...mdastNode, children: run }, listNode);
    }
  },
};

/**
 * The stock list item visitor, plus the item's looseness and the blank line before it, and content after a
 * nested list kept after it.
 */
export const MdastSpreadListItemVisitor: MdastImportVisitor<Mdast.ListItem> = {
  testNode: 'listItem',
  priority: 10,
  visitNode({ mdastNode, actions, lexicalParent }) {
    const isCheckList = $isListNode(lexicalParent) && lexicalParent.getListType() === 'check';
    const isChecked = isCheckList ? (mdastNode.checked ?? false) : undefined;
    const itemNode = $createListItemNode(isChecked);
    $setState(itemNode, listItemSpreadState, mdastNode.spread === true);
    $setState(itemNode, listItemBlankBeforeState, mdastNode.data?.blankBefore ?? null);
    $setState(itemNode, listItemGapsState, itemGaps(mdastNode.children));
    if (!$isElementNode(lexicalParent)) throw new Error(`a list item inside ${lexicalParent.getType()}`);
    lexicalParent.append(itemNode);
    for (const [index, child] of mdastNode.children.entries())
      actions.visitChildren({ ...mdastNode, children: [child] }, $childTarget(itemNode, mdastNode.children, index));
  },
};

const childrenOf = (node: Mdast.RootContent): Mdast.RootContent[] => ('children' in node ? node.children : []);

export const LexicalMarkedListVisitor: LexicalExportVisitor<ListNode, Mdast.List> = {
  testLexicalNode: $isListNode,
  priority: 10,
  shouldJoin: (prev, node) => prev.type === 'list' && node.type === 'list' && node.data?.continues === true,
  join: (prev, node) => ({ ...prev, children: [...childrenOf(prev), ...childrenOf(node)] }),
  visitLexicalNode({ lexicalNode, mdastParent, actions }) {
    const marker = $getState(lexicalNode, listMarkerState);
    const continues = $getState(lexicalNode, listContinuesState);
    const list = actions.appendToParent(mdastParent, {
      type: 'list',
      ordered: lexicalNode.getListType() === 'number',
      spread: $getState(lexicalNode, listSpreadState),
      children: [],
      ...(marker || continues ? { data: { ...(marker ? { marker } : {}), ...(continues ? { continues } : {}) } } : {}),
    });
    // The joined list comes back from appendToParent; the stock addAndStepInto would visit into the discarded one.
    if (list.type !== 'list') throw new Error(`a list was appended as ${list.type}`);
    actions.visitChildren(lexicalNode, list);
  },
};

/** The stock list item visitor, plus the item's looseness and the blank line before it. */
export const LexicalSpreadListItemVisitor: LexicalExportVisitor<ListItemNode, Mdast.ListItem> = {
  testLexicalNode: $isListItemNode,
  priority: 10,
  visitLexicalNode({ lexicalNode, mdastParent, actions }) {
    const children = lexicalNode.getChildren();
    const firstChild = children[0];
    if (children.length === 1 && $isListNode(firstChild)) {
      const prevListItemNode = mdastParent.children[mdastParent.children.length - 1];
      if (prevListItemNode?.type === 'listItem') actions.visitChildren(lexicalNode, prevListItemNode);
      else for (const item of firstChild.getChildren()) actions.visit(item, mdastParent);
      return;
    }
    const parentList = lexicalNode.getParent();
    const blankBefore = $getState(lexicalNode, listItemBlankBeforeState);
    const gaps = $getState(lexicalNode, listItemGapsState);
    const data: Mdast.ListItemData = {
      ...(blankBefore === null ? {} : { blankBefore }),
      ...(gaps === null ? {} : { gaps }),
    };
    const previous = mdastParent.children[mdastParent.children.length - 1];
    const listItem =
      $isContinuation(lexicalNode) && previous?.type === 'listItem'
        ? previous
        : actions.appendToParent(mdastParent, {
            type: 'listItem',
            checked:
              $isListNode(parentList) && parentList.getListType() === 'check'
                ? Boolean(lexicalNode.getChecked())
                : undefined,
            spread: $getState(lexicalNode, listItemSpreadState),
            children: [],
            ...(blankBefore === null && gaps === null ? {} : { data }),
          });
    if (listItem.type !== 'listItem') throw new Error(`a list item was appended as ${listItem.type}`);
    let surroundingParagraph: Mdast.Paragraph | null = null;
    for (const child of children) {
      const isInline =
        $isTextNode(child) ||
        $isLineBreakNode(child) ||
        (child.isInline() && ($isElementNode(child) || $isDecoratorNode(child)));
      if (isInline) {
        if (surroundingParagraph === null) {
          surroundingParagraph = { type: 'paragraph', children: [] };
          listItem.children.push(surroundingParagraph);
        }
        actions.visit(child, surroundingParagraph);
      } else {
        surroundingParagraph = null;
        actions.visit(child, listItem);
      }
    }
  },
};

/**
 * Puts a blank line between list items, and between an item's block children, exactly where the source had
 * one. Items made or reshaped in the editor fall back to the list's or the item's looseness.
 */
export const listItemGapJoin: Join = (left, right, parent) => {
  if (parent.type === 'list') {
    if (right.type !== 'listItem' || typeof right.data?.blankBefore !== 'boolean') return undefined;
    return right.data.blankBefore ? 1 : 0;
  }
  if (parent.type !== 'listItem') return undefined;
  // A rule made in the editor is written `---`, which right under a paragraph turns it into a heading.
  if (left.type === 'paragraph' && right.type === 'thematicBreak' && right.data?.source === undefined) return 1;
  const gaps = parent.data?.gaps;
  // Two paragraphs always need their blank line; the default join writes it.
  if (gaps?.length !== parent.children.length - 1 || (left.type === 'paragraph' && right.type === 'paragraph'))
    return undefined;
  const gap = gaps.find((_, index) => parent.children[index + 1] === right);
  return gap === undefined ? undefined : gap ? 1 : 0;
};

function withMarker(options: Options, ordered: boolean, marker: string): Options {
  if (ordered) return marker === '.' || marker === ')' ? { ...options, bulletOrdered: marker } : options;
  return marker === '*' || marker === '+' || marker === '-' ? { ...options, bullet: marker } : options;
}

/** Writes a list with its source marker; lists made in the editor keep the configured bullet. */
export const markedListHandler: Handle = (node: Mdast.List, parent, state, info) => {
  const marker = node.data?.marker;
  if (!marker) return defaultHandlers.list(node, parent, state, info);
  const options = state.options;
  state.options = withMarker(options, node.ordered === true, marker);
  try {
    return defaultHandlers.list(node, parent, state, info);
  } finally {
    state.options = options;
  }
};
