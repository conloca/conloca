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

export interface FragmentVocabulary {
  readonly components: Readonly<Record<string, AnyComponent>>;
  readonly elements: Readonly<Partial<Record<FragmentElementName, AnyComponent>>>;
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

export function defineFragmentComponents(input: {
  components?: Record<string, AnyComponent>;
  elements?: Partial<Record<FragmentElementName, AnyComponent>>;
}): FragmentVocabulary {
  const components = { ...input.components };
  const elements = { ...input.elements };
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
  return Object.freeze({ components: Object.freeze(components), elements: Object.freeze(elements) });
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
    isComponentRecord(value.elements)
  );
}

/** MDX's own rule: lowercase names without a dot are HTML elements, everything else is a component reference. */
export function isFragmentComponentName(name: string): boolean {
  return !/^[a-z]/.test(name) || name.includes('.');
}
