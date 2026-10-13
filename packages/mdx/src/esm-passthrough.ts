import type { Root, RootContent } from 'mdast';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

/**
 * Verbatim passthrough for MDX ESM statements (`import` / `export`).
 *
 * `@mdxeditor/editor` cannot represent an `mdxjsEsm` node: its shipped
 * `MdastMdxJsEsmVisitor` matches the node and its `visitNode` body is empty, so
 * nothing reaches the Lexical tree. On export the library *rebuilds* an import
 * block from scratch, using only the components it saw referred to in the
 * document (`exportMarkdownFromLexical.js`). Three ways that loses author data,
 * all reproduced against v3.55.0 in `esm-passthrough.test.ts`:
 *
 *  1. A component nested inside another JSX element is registered by name with
 *     no import source attached, so its specifier is pruned from the rebuilt
 *     line — `import { Tabs, TabItem }` comes back as `import { Tabs }` while
 *     `<TabItem>` is still in the document. Astro then fails the site's
 *     build with `TabItem is not defined`.
 *  2. `export const …` is dropped outright, taking any `{value}` expression
 *     that referenced it down with it.
 *  3. Side-effect imports (`import './styles.css'`) and specifiers that are
 *     imported but never referenced are dropped.
 *
 * Even when the rebuild keeps every name it is not byte-faithful: the library
 * emits `import { X } from 'y'` with no trailing semicolon and orders
 * specifiers by first reference, so a no-op save still rewrites the line.
 *
 * The fix keeps ESM out of the editor entirely. `splitEsm` lifts the statements
 * off the markdown before the editor parses it and `joinEsm` puts them back,
 * byte for byte, on the way out. Because the editor never sees an `mdxjsEsm`
 * node, the library's `gatherMetadata` finds no import declarations and its
 * rebuild produces nothing to collide with — except for components registered
 * with an explicit `import.from` (see `MdxJsxComponentDescriptor`), which
 * `joinEsm` reconciles so a binding is never declared twice.
 *
 * This narrows what reaches `compileMDX`, so it cannot weaken the
 * `remarkRestrictExpressions` gate: the editor's live markdown now carries
 * strictly fewer ESM statements than before, never more.
 */

/**
 * Cheap pre-filter. A real parse is the only way to tell an ESM statement from
 * an `import` line inside a fenced code block, but the overwhelming majority of
 * documents have no line starting with `import`/`export` at all, and this keeps
 * those off the parser entirely. False positives are harmless — they fall
 * through to the parse, which decides.
 */
const ESM_HINT = /^(?:import|export)\b/m;

const parser = unified().use(remarkParse).use(remarkMdx);

type MdxjsEsmNode = Extract<RootContent, { type: 'mdxjsEsm' }>;

/** Type guard so `data.estree` narrows without a cast. */
function isEsmNode(node: RootContent): node is MdxjsEsmNode {
  return node.type === 'mdxjsEsm';
}

/** An ESM statement lifted out of a document, with its bindings resolved. */
interface EsmStatement {
  /** Statement source text, exactly as authored. */
  readonly text: string;
  /** Names the statement introduces into module scope. */
  readonly bindings: readonly string[];
  /** Module specifier, when this is an `import`. */
  readonly source: string | undefined;
  /** True when the statement binds a default or namespace import. */
  readonly bindsDefault: boolean;
}

/** ESM lifted off a document, ready to be re-attached by {@link joinEsm}. */
export interface PreservedEsm {
  /**
   * Verbatim text to re-emit ahead of the edited body — the document's leading
   * ESM block including the blank lines around it, so a no-op edit reproduces
   * the original bytes exactly. `''` when the document had no ESM.
   */
  readonly prefix: string;
  /** The markdown to hand the editor: the source with `prefix` removed. */
  readonly body: string;
  /** Every binding name declared by the preserved statements. */
  readonly bindings: ReadonlySet<string>;
}

/**
 * Parse far enough to locate `mdxjsEsm` nodes. Returns `undefined` when the
 * document does not parse — acorn rejects `import type { … }`, for instance,
 * which also makes the editor itself fall back to source view. Bailing out
 * leaves behaviour exactly as it was.
 */
function parseOrUndefined(source: string): Root | undefined {
  try {
    return parser.parse(source);
  } catch {
    return undefined;
  }
}

/**
 * Resolve the bindings an `mdxjsEsm` node introduces, from the estree that
 * `micromark-extension-mdxjs` attaches (it parses with `addResult: true`).
 * A statement whose bindings cannot be resolved contributes none and is simply
 * preserved as opaque text.
 */
function describeEsm(node: MdxjsEsmNode, text: string): EsmStatement {
  const bindings: string[] = [];
  let source: string | undefined;
  let bindsDefault = false;

  for (const statement of node.data?.estree?.body ?? []) {
    if (statement.type === 'ImportDeclaration') {
      if (typeof statement.source.value === 'string') source = statement.source.value;
      for (const specifier of statement.specifiers) {
        bindings.push(specifier.local.name);
        if (specifier.type !== 'ImportSpecifier') bindsDefault = true;
      }
      continue;
    }
    if (statement.type === 'ExportNamedDeclaration') {
      const declaration = statement.declaration;
      if (declaration?.type === 'VariableDeclaration') {
        for (const declarator of declaration.declarations) {
          if (declarator.id.type === 'Identifier') bindings.push(declarator.id.name);
        }
      } else if (declaration?.id != null) {
        bindings.push(declaration.id.name);
      }
      for (const specifier of statement.specifiers) {
        if (specifier.exported.type === 'Identifier') bindings.push(specifier.exported.name);
      }
      continue;
    }
    if (statement.type === 'ExportDefaultDeclaration') bindings.push('default');
  }

  return { text, bindings, source, bindsDefault };
}

/** Number of leading root children that are ESM statements. */
function countLeadingEsm(children: readonly RootContent[]): number {
  let count = 0;
  for (const node of children) {
    if (!isEsmNode(node)) break;
    count += 1;
  }
  return count;
}

/**
 * Offset where the body proper starts, i.e. the first root child that is not an
 * ESM statement. Equal to `fallback` for an all-ESM document.
 */
function firstContentOffset(children: readonly RootContent[], leadingCount: number, fallback: number): number {
  const firstContent = leadingCount < children.length ? children[leadingCount] : undefined;
  return firstContent?.position?.start.offset ?? fallback;
}

/**
 * Lift every ESM statement off `source`.
 *
 * The document's leading ESM block is preserved as a literal slice, so
 * re-attaching it reproduces the original bytes. Statements that appear *below*
 * the first content block are hoisted into that same block: their original
 * position is not recoverable once the user has restructured the body, and MDX
 * compiles ESM to module scope regardless of where it sat, so hoisting keeps
 * the site's build working at the cost of moving those lines. Relative
 * order among the statements is preserved.
 */
export function splitEsm(source: string): PreservedEsm {
  const untouched: PreservedEsm = { prefix: '', body: source, bindings: new Set() };
  if (!ESM_HINT.test(source)) return untouched;

  const tree = parseOrUndefined(source);
  if (tree === undefined) return untouched;

  const children = tree.children;
  const leadingCount = countLeadingEsm(children);
  // Everything up to the first non-ESM block: the statements plus the blank
  // lines around them, verbatim. A document that is *only* ESM keeps all of it.
  const leadingText =
    leadingCount === 0 ? '' : source.slice(0, firstContentOffset(children, leadingCount, source.length));

  const leading: EsmStatement[] = [];
  const hoisted: EsmStatement[] = [];
  const cuts: Array<{ start: number; end: number }> = [];

  for (const [index, node] of children.entries()) {
    if (!isEsmNode(node)) continue;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    // Positions are always present from a string parse; without them the text
    // cannot be recovered, so leave the document alone rather than guess.
    if (start === undefined || end === undefined) return untouched;
    const statement = describeEsm(node, source.slice(start, end));
    if (index < leadingCount) {
      leading.push(statement);
    } else {
      hoisted.push(statement);
      cuts.push({ start, end });
    }
  }

  if (leading.length === 0 && hoisted.length === 0) return untouched;

  // Cut hoisted statements out of the body back-to-front so earlier offsets stay
  // valid. Blank lines left behind are irrelevant: the editor re-serializes the
  // body regardless.
  let body = source.slice(leadingText.length);
  for (const cut of [...cuts].reverse()) {
    body = body.slice(0, cut.start - leadingText.length) + body.slice(cut.end - leadingText.length);
  }

  return {
    prefix: hoisted.length === 0 ? leadingText : `${leadingText}${hoisted.map((s) => s.text).join('\n')}\n\n`,
    body,
    bindings: new Set([...leading, ...hoisted].flatMap((s) => s.bindings)),
  };
}

/**
 * Re-attach preserved ESM to markdown coming out of the editor.
 *
 * Any import the library rebuilt for a descriptor carrying `import.from` is
 * reconciled against the preserved bindings first, so nothing is declared
 * twice: a rebuilt statement whose every binding is already preserved is
 * dropped, and one that also carries a new binding is narrowed to just the new
 * names. The author's own statements are never rewritten.
 */
export function joinEsm(preserved: PreservedEsm, body: string): string {
  if (preserved.prefix === '') return body;
  if (!ESM_HINT.test(body)) return preserved.prefix + body;

  const tree = parseOrUndefined(body);
  if (tree === undefined) return preserved.prefix + body;

  const children = tree.children;
  const leadingCount = countLeadingEsm(children);
  if (leadingCount === 0) return preserved.prefix + body;

  const kept: string[] = [];
  for (const node of children.slice(0, leadingCount)) {
    if (!isEsmNode(node)) continue;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;

    const statement = describeEsm(node, body.slice(start, end));
    const fresh = statement.bindings.filter((name) => !preserved.bindings.has(name));
    if (statement.bindings.length === 0 || fresh.length === statement.bindings.length) {
      kept.push(statement.text);
      continue;
    }
    if (fresh.length === 0) continue;
    // Partially covered. Only a rebuilt named import can land here, and it was
    // generated by the library rather than authored, so narrowing it to the new
    // names loses nothing the author wrote.
    if (statement.source === undefined || statement.bindsDefault) {
      kept.push(statement.text);
      continue;
    }
    kept.push(`import { ${fresh.join(', ')} } from '${statement.source}'`);
  }

  // An all-ESM body leaves nothing after the statements.
  const rest = body.slice(firstContentOffset(children, leadingCount, body.length));
  return preserved.prefix + (kept.length === 0 ? rest : `${kept.join('\n')}\n\n${rest}`);
}
