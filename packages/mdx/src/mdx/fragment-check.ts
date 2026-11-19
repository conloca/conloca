import type { Root, RootContent } from 'mdast';
import { componentPropValue, fragmentComponentProps } from './component-props.js';
import { parseFragmentMdx } from './evaluate.js';
import { type JsonValue, jsonAttributeValue, literalAttributeValue, staticDataValue } from './literal-attributes.js';
import { isNestedHandlerKey, remarkRestrictExpressions, sanitizeAttributes } from './restrict-expressions.js';
import { isFragmentComponentName } from './vocabulary.js';
import { findUnknownFragmentComponents } from './vocabulary-check.js';

/** What a site declares about one fragment component prop, as plain data. */
export type FragmentPropSpec =
  | { type: 'string'; options?: readonly string[]; required?: boolean }
  | { type: 'number' | 'boolean'; required?: boolean }
  | { type: 'list'; of: FragmentPropSpec; required?: boolean }
  | { type: 'object'; fields: Readonly<Record<string, FragmentPropSpec>>; required?: boolean };

/** A descriptor field, structurally: the editor's prop descriptors and the component manifest's props both fit. */
export type FragmentPropField =
  | { type: 'string'; required?: boolean; options?: ReadonlyArray<{ value: string }> }
  | { type: 'number' | 'boolean'; required?: boolean }
  | { type: 'list'; required?: boolean; of: FragmentPropField }
  | { type: 'object'; required?: boolean; fields: Readonly<Record<string, FragmentPropField>> };

/** The prop spec `checkFragmentMdx` reads for one descriptor field. */
export function fragmentPropSpec(field: FragmentPropField): FragmentPropSpec {
  const required = field.required ? { required: true } : {};
  switch (field.type) {
    case 'string':
      return { type: 'string', ...(field.options ? { options: field.options.map((o) => o.value) } : {}), ...required };
    case 'number':
    case 'boolean':
      return { type: field.type, ...required };
    case 'list':
      return { type: 'list', of: fragmentPropSpec(field.of), ...required };
    case 'object':
      return {
        type: 'object',
        fields: Object.fromEntries(Object.entries(field.fields).map(([name, f]) => [name, fragmentPropSpec(f)])),
        ...required,
      };
    default: {
      const unknownField: never = field;
      throw new Error(`Unknown prop type ${JSON.stringify(unknownField)}`);
    }
  }
}

export interface FragmentMdxProblem {
  message: string;
  line?: number;
}

type Node = Root | RootContent;

function nodes(root: Root): Node[] {
  const out: Node[] = [];
  const walk = (node: Node): void => {
    out.push(node);
    if ('children' in node) node.children.forEach(walk);
  };
  walk(root);
  return out;
}

const lineOf = (node: Node): number => node.position?.start.line ?? 1;

/** The path below `path` of the first string-valued `on*` key publish drops from `value`, or undefined. */
function nestedHandlerPath(value: JsonValue, path: string): string | undefined {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = nestedHandlerPath(item, `${path}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  for (const [key, item] of Object.entries(value)) {
    if (key.toLowerCase() === 'dangerouslysetinnerhtml') continue;
    if (isNestedHandlerKey(key, item)) return `${path}.${key}`;
    const found = nestedHandlerPath(item, `${path}.${key}`);
    if (found) return found;
  }
  return undefined;
}

function expectation(spec: FragmentPropSpec): string {
  switch (spec.type) {
    case 'string':
      return spec.options ? `one of ${spec.options.join(', ')}` : 'text';
    case 'number':
      return 'a number';
    case 'boolean':
      return 'true or false';
    case 'list':
      return 'a list';
    case 'object':
      return 'an object';
    default: {
      const unknownSpec: never = spec;
      throw new Error(`Unknown prop spec ${JSON.stringify(unknownSpec)}`);
    }
  }
}

/** The path of the first value in `value` that `spec` refuses, with what it must be or that it is missing. */
function checkValue(
  value: JsonValue,
  spec: FragmentPropSpec,
  path: string,
): { path: string; missing: boolean; spec: FragmentPropSpec } | undefined {
  const wrong = { path, missing: false, spec };
  switch (spec.type) {
    case 'string':
      return typeof value === 'string' && (!spec.options || spec.options.includes(value)) ? undefined : wrong;
    case 'number':
      return typeof value === 'number' ? undefined : wrong;
    case 'boolean':
      return typeof value === 'boolean' ? undefined : wrong;
    case 'list':
      if (!Array.isArray(value)) return wrong;
      for (const [index, item] of value.entries()) {
        const problem = checkValue(item, spec.of, `${path}[${index}]`);
        if (problem) return problem;
      }
      return undefined;
    case 'object':
      if (!value || typeof value !== 'object' || Array.isArray(value)) return wrong;
      return checkFields(value, spec.fields, `${path}.`);
    default: {
      const unknownSpec: never = spec;
      throw new Error(`Unknown prop spec ${JSON.stringify(unknownSpec)}`);
    }
  }
}

function checkFields(
  values: Readonly<Record<string, JsonValue>>,
  specs: Readonly<Record<string, FragmentPropSpec>>,
  prefix: string,
): { path: string; missing: boolean; spec: FragmentPropSpec } | undefined {
  for (const [name, spec] of Object.entries(specs)) {
    const path = `${prefix}${name}`;
    const value = Object.keys(values).includes(name) ? values[name] : undefined;
    if (value === undefined) {
      // The props panel removes a false boolean, and publish passes undefined: absent reads as false.
      if (spec.required && spec.type !== 'boolean') return { path, missing: true, spec };
      continue;
    }
    const problem = checkValue(value, spec, path);
    if (problem) return problem;
  }
  return undefined;
}

/**
 * Why the published renderer would refuse or change `mdx`, or undefined when it renders as written. Pure: it parses,
 * never evaluates. `propSpecs` checks only declared props of components it names. `componentNames` undefined (the
 * site's vocabulary is unknown) skips only the unknown-component check.
 */
export function checkFragmentMdx(
  mdx: string,
  componentNames: ReadonlySet<string> | undefined,
  propSpecs: Readonly<Record<string, Readonly<Record<string, FragmentPropSpec>>>>,
): FragmentMdxProblem | undefined {
  let all: Node[];
  try {
    all = nodes(parseFragmentMdx(mdx));
  } catch (error) {
    return { message: `The fragment could not be read: ${error instanceof Error ? error.message : String(error)}.` };
  }

  const esm = all.find((node) => node.type === 'mdxjsEsm');
  if (esm) {
    const line = lineOf(esm);
    return {
      message: `Fragments can't contain import or export lines (line ${line}). Remove them: the site's components need no import.`,
      line,
    };
  }

  // Mirrors the gate's `isComment`: a program with no statements is a comment and is removed, not refused.
  const expression = all.find((node) => {
    if (node.type !== 'mdxFlowExpression' && node.type !== 'mdxTextExpression') return false;
    const body = node.data?.estree?.body;
    return !Array.isArray(body) || body.length > 0;
  });
  if (expression) {
    const line = lineOf(expression);
    return { message: `Fragments can't contain {…} expressions (line ${line}).`, line };
  }

  const unknown = componentNames ? findUnknownFragmentComponents(mdx, componentNames) : [];
  if (unknown.length > 0) {
    const names = [...new Set(unknown.map((u) => `<${u.name}>`))].join(', ');
    const offered =
      componentNames && componentNames.size > 0
        ? `Components this site offers in fragments: ${[...componentNames].join(', ')}.`
        : 'This site offers no components in fragments.';
    const line = unknown[0]?.line ?? 1;
    return { message: `Fragments can't use ${names} (line ${line}). ${offered}`, line };
  }

  for (const node of all) {
    if ((node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') || !node.name) continue;
    const name = node.name;
    const component = isFragmentComponentName(name);
    const line = lineOf(node);
    for (const attr of node.attributes) {
      if (attr.type === 'mdxJsxExpressionAttribute') {
        return { message: `${name} can't spread {…} props: they would not be published (line ${line}).`, line };
      }
      if (attr.name.toLowerCase() === 'style') continue; // dropped by design, not an author error
      if (/^on/i.test(attr.name)) {
        const what = component ? 'prop' : 'attribute';
        return {
          message: `${name} ${what} "${attr.name}" would not be published: names starting with "on" are never passed; rename it (line ${line}).`,
          line,
        };
      }
      const raw = attr.value && typeof attr.value === 'object' ? attr.value.value : undefined;
      if (raw !== undefined && staticDataValue(raw) === undefined) {
        const message = component
          ? `${name} prop "${attr.name}" is code, not data, and would not be published (line ${line}).`
          : `${name} attribute "${attr.name}" is code and would not be published (line ${line}).`;
        return { message, line };
      }
      // The gate drops `on*`, `__proto__` and `dangerouslySetInnerHTML`; React consumes `key`; a component also drops a
      // `null` prop, and raw HTML keeps only a string, number or boolean `{…}` value.
      const dropped = component
        ? componentPropValue(attr) === undefined
        : raw !== undefined && literalAttributeValue(raw) === undefined;
      if (attr.name === 'key' || sanitizeAttributes([attr], component).length === 0 || dropped) {
        return {
          message: `${name} ${component ? 'prop' : 'attribute'} "${attr.name}" would not be published (line ${line}).`,
          line,
        };
      }
      const parsed = component && raw !== undefined ? jsonAttributeValue(raw) : undefined;
      const handler = parsed === undefined ? undefined : nestedHandlerPath(parsed, attr.name);
      if (handler) {
        return {
          message: `${name} prop "${handler}" would not be published: string values under names starting with "on" are dropped (line ${line}).`,
          line,
        };
      }
    }
    if (!component) continue;
    const specs = Object.keys(propSpecs).includes(name) ? propSpecs[name] : undefined;
    if (!specs) continue;
    const problem = checkFields(fragmentComponentProps(node.attributes ?? []), specs, '');
    if (problem) {
      const message = problem.missing
        ? `${name} needs prop "${problem.path}" (line ${line}).`
        : `${name} prop "${problem.path}" must be ${expectation(problem.spec)} (line ${line}).`;
      return { message, line };
    }
  }
  return undefined;
}

/**
 * Whether `mdx` carries no author code: {@link checkFragmentMdx} finds nothing with every component it names allowed
 * (components are the site's own code), and the published renderer's gate refuses, drops and empties nothing. For a
 * file a site's own MDX compile builds, where nothing neutralizes it first. A file that does not parse carries code.
 */
export function mdxCarriesNoCode(mdx: string): boolean {
  try {
    const named = new Set(findUnknownFragmentComponents(mdx, new Set()).map((found) => found.name));
    if (checkFragmentMdx(mdx, named, {}) !== undefined) return false;
    const tree = parseFragmentMdx(mdx);
    const before = JSON.stringify(tree);
    // SAFETY: the gate walks loose structural nodes (restrict-expressions.ts) and `Root` is one; evaluate.ts bridges it
    // into unified the same way.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions, typescript/no-unsafe-type-assertion -- same reason as the SAFETY note.
    (remarkRestrictExpressions() as unknown as (root: Root) => void)(tree);
    return JSON.stringify(tree) === before;
  } catch {
    return false;
  }
}
