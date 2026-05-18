import { Trash2 } from 'lucide-react';
import { useSelectedBlock } from '../../selected-block';

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
              name={prop.name}
              label={prop.label}
              help={prop.help}
              required={prop.required}
              value={attrs[prop.name] ?? ''}
              options={prop.type === 'string' ? prop.options : undefined}
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
  name: string;
  label?: string;
  help?: string;
  required?: boolean;
  value: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

function PropField({ name, label, help, required, value, options, onChange }: PropFieldProps) {
  const display = label ?? name;
  return (
    <label className="conloca-jsx-props-panel__field">
      <span className="conloca-jsx-props-panel__label">
        {display}
        {required && <em aria-hidden> *</em>}
      </span>
      {options && options.length > 0 ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={display}>
          <option value="">—</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={display}
          aria-label={display}
        />
      )}
      {help && <small className="conloca-jsx-props-panel__help">{help}</small>}
    </label>
  );
}
