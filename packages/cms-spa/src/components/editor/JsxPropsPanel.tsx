import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { containsMarkdownMarkers, type MdxComponentProp } from '../../mdx-components';
import { useSelectedBlock } from '../../selected-block';
import { SearchableSelect } from './SearchableSelect';

/**
 * Above this many options, swap the native `<select>` for the
 * searchable combobox. Native selects are great up to ~20 entries
 * (scroll + arrow keys are enough); beyond that, finding a value
 * means scrolling through a wall of text. Starlight's `<Icon>` ships
 * ~270 options — comfortably past this threshold.
 */
const SEARCHABLE_THRESHOLD = 20;

/**
 * Fixed-position right-side panel showing prop fields for the
 * currently-selected MDX JSX block (Aside, Card, etc).
 *
 * Reads the selected block from the shared registry — `GenericBlock`
 * publishes itself there on selection. The block's descriptor drives
 * which form fields render; changes go back through the descriptor's
 * bound `onPropChange` closure, which routes through the block's own
 * `useMdastNodeUpdater` so the edit lands on the right mdast node.
 *
 * Renders nothing when no block is selected. The author still sees a
 * clean content surface and can type freely; the panel only shows up
 * when there's something to edit.
 */
export function JsxPropsPanel() {
  const selected = useSelectedBlock();

  if (!selected) {
    return (
      <aside className="conloca-jsx-props-panel conloca-jsx-props-panel--empty">
        <p className="conloca-jsx-props-panel__hint">Select a component to edit its props.</p>
      </aside>
    );
  }

  const { descriptor, attrs, onPropChange, onRemove } = selected;

  return (
    <aside className="conloca-jsx-props-panel">
      <header className="conloca-jsx-props-panel__header">
        <h3 className="conloca-jsx-props-panel__title">{descriptor.name}</h3>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${descriptor.name}`}
          className="conloca-jsx-props-panel__remove"
        >
          <Trash2 size={14} aria-hidden /> Remove
        </button>
      </header>
      {descriptor.props && descriptor.props.length > 0 ? (
        <div className="conloca-jsx-props-panel__fields">
          {descriptor.props.map((prop) => (
            <PropField
              key={prop.name}
              prop={prop}
              rawValue={attrs[prop.name]}
              onChange={(next) => onPropChange(prop.name, next)}
            />
          ))}
        </div>
      ) : (
        <p className="conloca-jsx-props-panel__hint">No editable props.</p>
      )}
    </aside>
  );
}

interface PropFieldProps {
  prop: MdxComponentProp;
  /** Current value as decoded from mdast — string for `prop="..."`,
   * boolean for shorthand `<X prop />` or `prop={true}`, number for
   * `prop={42}`, etc. May be `undefined` if the attribute isn't set. */
  rawValue: unknown;
  /** Apply a prop change. The block's bound handler accepts the full
   * value-type union; see `selected-block.ts` for the contract. */
  onChange: (value: string | boolean | number | null | undefined) => void;
}

/**
 * One field in the side panel, type-discriminated by `prop.type`:
 *
 *   - `string`  with options → `<select>` (immediate commit)
 *   - `string`  without options → `<input type="text">` (commit on blur)
 *   - `boolean` → `<input type="checkbox">`
 *   - `number`  → `<input type="number">` (commit on blur)
 *
 * Text and number inputs commit on blur (not per-keystroke) because
 * each commit refocuses the editor's contenteditable — keystroke-
 * committing would steal focus after every character. Checkboxes and
 * selects commit immediately; their interactions are discrete.
 */
function PropField({ prop, rawValue, onChange }: PropFieldProps) {
  const display = prop.label ?? prop.name;
  const help = prop.help;

  if (prop.type === 'boolean') {
    // Truthy attrs.value (boolean shorthand, the string "true", an
    // expression that evaluated to true) all → checked. Anything
    // else → unchecked. Commit sends `true` for checked, `null` for
    // unchecked — `writeAttribute` then encodes shorthand or removes
    // the attribute entirely.
    const checked = rawValue === true || rawValue === 'true';
    return (
      <label className="conloca-jsx-props-panel__field conloca-jsx-props-panel__field--inline">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked ? true : null)}
          aria-label={display}
        />
        <span className="conloca-jsx-props-panel__label">
          {display}
          {prop.required && <em aria-hidden> *</em>}
        </span>
        {help && <small className="conloca-jsx-props-panel__help">{help}</small>}
      </label>
    );
  }

  if (prop.type === 'number') {
    return (
      <label className="conloca-jsx-props-panel__field">
        <span className="conloca-jsx-props-panel__label">
          {display}
          {prop.required && <em aria-hidden> *</em>}
        </span>
        <NumberInput
          value={typeof rawValue === 'number' ? rawValue : typeof rawValue === 'string' ? Number(rawValue) : undefined}
          onCommit={(next) => onChange(next)}
          ariaLabel={display}
        />
        {help && <small className="conloca-jsx-props-panel__help">{help}</small>}
      </label>
    );
  }

  // String (default). With options → select; without → text input.
  const stringValue = typeof rawValue === 'string' ? rawValue : rawValue == null ? '' : String(rawValue);
  // Mirror the inline-prop wiring's bail rule (see `containsMarkdownMarkers`
  // in mdx-components). When the current value carries markdown, the
  // SSR'd preview can't be edited in place — plaintext-only would strip
  // the formatting — so the author edits here instead. The hint tells
  // them why the inline affordance isn't lighting up for this prop.
  const isMarkdown = containsMarkdownMarkers(stringValue);
  return (
    <label className="conloca-jsx-props-panel__field">
      <span className="conloca-jsx-props-panel__label">
        {display}
        {prop.required && <em aria-hidden> *</em>}
      </span>
      {prop.options && prop.options.length > 0 ? (
        prop.options.length > SEARCHABLE_THRESHOLD ? (
          <SearchableSelect
            options={prop.options}
            value={stringValue}
            onChange={(next) => onChange(next)}
            placeholder={display}
            ariaLabel={display}
          />
        ) : (
          <select value={stringValue} onChange={(e) => onChange(e.target.value)} aria-label={display}>
            <option value="">—</option>
            {prop.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        )
      ) : (
        <TextInput value={stringValue} onCommit={(next) => onChange(next)} placeholder={display} ariaLabel={display} />
      )}
      {isMarkdown && (
        <small className="conloca-jsx-props-panel__help conloca-jsx-props-panel__help--md">
          Contains markdown — edit here, not inline.
        </small>
      )}
      {help && <small className="conloca-jsx-props-panel__help">{help}</small>}
    </label>
  );
}

/**
 * Controlled text input with on-blur commit. Keeps a local draft so
 * typing doesn't trigger the mdast-update → Lexical-refocus path
 * mid-keystroke. Enter commits, Escape reverts. Resyncs when the
 * external `value` changes (eg the inline editor committed for the
 * same prop).
 */
function TextInput({
  value,
  onCommit,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value);
  const committedRef = useRef(value);
  useEffect(() => {
    if (value !== committedRef.current) {
      setDraft(value);
      committedRef.current = value;
    }
  }, [value]);
  const commit = () => {
    if (draft !== committedRef.current) {
      committedRef.current = draft;
      onCommit(draft);
    }
  };
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(committedRef.current);
        }
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  );
}

/**
 * Number input with on-blur commit. Empty string → `null` (remove
 * attribute). Same focus-preservation rationale as `TextInput`.
 */
function NumberInput({
  value,
  onCommit,
  ariaLabel,
}: {
  value: number | undefined;
  onCommit: (value: number | null) => void;
  ariaLabel?: string;
}) {
  const initial = value == null || Number.isNaN(value) ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  const committedRef = useRef(initial);
  useEffect(() => {
    if (initial !== committedRef.current) {
      setDraft(initial);
      committedRef.current = initial;
    }
  }, [initial]);
  const commit = () => {
    if (draft === committedRef.current) return;
    committedRef.current = draft;
    if (draft === '') {
      onCommit(null);
      return;
    }
    const n = Number(draft);
    if (!Number.isFinite(n)) return;
    onCommit(n);
  };
  return (
    <input
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(committedRef.current);
        }
      }}
      aria-label={ariaLabel}
    />
  );
}
