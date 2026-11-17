import type { ComponentType } from 'react';

/** HTML elements a fragment's Markdown can produce, and so the elements a site may override. */
export const FRAGMENT_ELEMENT_NAMES = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'pre',
  'code',
  'img',
  'strong',
  'em',
  'del',
] as const;

export type FragmentElementName = (typeof FRAGMENT_ELEMENT_NAMES)[number];

// biome-ignore lint/suspicious/noExplicitAny: site components take arbitrary props
type AnyComponent = ComponentType<any>;

/** The props of a fragment component that make it a contents entry: its anchor id and its contents text. */
export interface FragmentOutlineProps {
  readonly id: string;
  readonly text: string;
}

export interface FragmentVocabulary {
  readonly components: Readonly<Record<string, AnyComponent>>;
  readonly elements: Readonly<Partial<Record<FragmentElementName, AnyComponent>>>;
  /** Components that are contents entries, keyed by component name. Optional so a hand-built vocabulary still counts. */
  readonly outline?: Readonly<Record<string, FragmentOutlineProps>>;
}

const COMPONENT_KEY = /^[A-Z][A-Za-z0-9]*$/;
const ELEMENT_NAMES: ReadonlySet<string> = new Set(FRAGMENT_ELEMENT_NAMES);

// Functions, or React's exotic components (memo, forwardRef, lazy) which are objects tagged with $$typeof.
function isComponent(value: unknown): boolean {
  return typeof value === 'function' || (typeof value === 'object' && value !== null && '$$typeof' in value);
}

function isComponentRecord(value: unknown): value is Record<string, AnyComponent> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(value).every(isComponent)
  );
}

function isOutlineProps(value: unknown): value is FragmentOutlineProps {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'text' in value &&
    typeof value.id === 'string' &&
    value.id !== '' &&
    typeof value.text === 'string' &&
    value.text !== ''
  );
}

function isOutlineRecord(value: unknown): value is Record<string, FragmentOutlineProps> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(value).every(isOutlineProps)
  );
}

/**
 * `outline` declares which components are contents entries and which of their props hold the anchor id and the
 * contents text, e.g. `{ Section: { id: 'id', text: 'label' } }`; evaluation reports them as `componentOutline`.
 */
export function defineFragmentComponents(input: {
  components?: Record<string, AnyComponent>;
  elements?: Partial<Record<FragmentElementName, AnyComponent>>;
  outline?: Record<string, FragmentOutlineProps>;
}): FragmentVocabulary {
  const components = { ...input.components };
  const elements = { ...input.elements };
  const outline: Record<string, FragmentOutlineProps> = {};
  for (const [key, value] of Object.entries(components)) {
    if (!COMPONENT_KEY.test(key)) {
      throw new TypeError(`Fragment component "${key}" must be a capitalised identifier like "Callout"`);
    }
    if (!isComponent(value)) throw new TypeError(`Fragment component "${key}" is not a React component`);
  }
  for (const [key, value] of Object.entries(elements)) {
    if (!ELEMENT_NAMES.has(key)) {
      throw new TypeError(`Fragment element "${key}" is not one of ${FRAGMENT_ELEMENT_NAMES.join(', ')}`);
    }
    if (!isComponent(value)) throw new TypeError(`Fragment element "${key}" is not a React component`);
  }
  for (const [key, value] of Object.entries(input.outline ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(components, key)) {
      throw new TypeError(`Fragment outline entry "${key}" is not a component`);
    }
    if (!isOutlineProps(value)) {
      throw new TypeError(`Fragment outline entry "${key}" must name its id and text props as non-empty strings`);
    }
    outline[key] = Object.freeze({ id: value.id, text: value.text });
  }
  return Object.freeze({
    components: Object.freeze(components),
    elements: Object.freeze(elements),
    outline: Object.freeze(outline),
  });
}

export const EMPTY_FRAGMENT_VOCABULARY: FragmentVocabulary = defineFragmentComponents({});

/** Structural check, so a vocabulary built by another copy of this package still counts. */
export function isFragmentVocabulary(value: unknown): value is FragmentVocabulary {
  return (
    typeof value === 'object' &&
    value !== null &&
    'components' in value &&
    'elements' in value &&
    isComponentRecord(value.components) &&
    isComponentRecord(value.elements) &&
    (!('outline' in value) || value.outline === undefined || isOutlineRecord(value.outline))
  );
}

/** MDX's own rule: lowercase names without a dot are HTML elements, everything else is a component reference. */
export function isFragmentComponentName(name: string): boolean {
  return !/^[a-z]/.test(name) || name.includes('.');
}
