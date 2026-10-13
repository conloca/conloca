import { useId, useRef } from 'react';
import type { FieldHint, FieldHintVariant, PageSchemaGroup } from '../../page-schemas.js';
import { ImageFieldRender } from '../fields/ImageField.js';
import { Input, Select, Textarea } from '../ui/index.js';
import { ChipArrayField } from './ChipArrayField.js';

interface HintFormProps {
  hints: Record<string, FieldHint>;
  groups?: ReadonlyArray<PageSchemaGroup>;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  className?: string;
}

/**
 * Renders a page-settings form driven by host-declared field hints.
 *
 * Each entry in `hints` is keyed either by a flat field name (`title`) or a
 * dotted path (`sidebar.label`). Dotted keys are used verbatim against
 * `values` — `pageMetadata.ts:flattenForHints` / `unflattenFromHints`
 * adapt between flat form state and nested YAML on the boundary.
 *
 * When `groups` is provided, fields are bucketed by `hint.group`; fields
 * without a group go into a default section rendered first.
 */
export function HintForm({ hints, groups, values, onChange, className }: HintFormProps) {
  const setField = (name: string, value: unknown) => onChange({ ...values, [name]: value });

  // A hidden field renders nothing, and its wrapper below would still add a gap to space-y.
  const shown = Object.entries(hints).filter(([, hint]) => hint.hidden !== true);

  // The wrapper names the field, so a dialog can open at it (see PageMetadataDialog's focusField).
  const renderField = (name: string, hint: FieldHint) => (
    <div key={name} data-field-name={name}>
      <HintField name={name} hint={hint} value={values[name]} onChange={(v) => setField(name, v)} />
    </div>
  );

  if (!groups || groups.length === 0) {
    return (
      <div className={className}>
        <div className="space-y-6">{shown.map(([n, h]) => renderField(n, h))}</div>
      </div>
    );
  }

  const ungrouped: Array<[string, FieldHint]> = [];
  const byGroup = new Map<string, Array<[string, FieldHint]>>();
  for (const [name, hint] of shown) {
    if (hint.group && byGroup.has(hint.group)) {
      byGroup.get(hint.group)?.push([name, hint]);
    } else if (hint.group) {
      byGroup.set(hint.group, [[name, hint]]);
    } else {
      ungrouped.push([name, hint]);
    }
  }

  return (
    <div className={className}>
      {ungrouped.length > 0 && <div className="space-y-6">{ungrouped.map(([n, h]) => renderField(n, h))}</div>}
      {groups.map((g) => {
        const fields = byGroup.get(g.id);
        if (!fields || fields.length === 0) return null;
        return (
          <section key={g.id} className="mt-6">
            <h3 className="text-sm font-semibold text-grey-01 dark:text-grey-12 mb-3">{g.label}</h3>
            {g.description && <p className="text-xs text-grey-04 dark:text-grey-07 mb-3">{g.description}</p>}
            <div className="space-y-6">{fields.map(([n, h]) => renderField(n, h))}</div>
          </section>
        );
      })}
    </div>
  );
}

interface HintFieldProps {
  name: string;
  hint: FieldHint;
  value: unknown;
  onChange: (value: unknown) => void;
}

function HintField({ name, hint, value, onChange }: HintFieldProps) {
  const inputId = useId();
  if (hint.hidden) {
    if (typeof hint.hidden === 'function') {
      // Caller passes `values` so this check is best-effort against the field
      // it's attached to; for now we don't recompute on each keystroke.
    } else if (hint.hidden) {
      return null;
    }
  }

  const label = hint.label ?? formatLabel(name);
  const description = hint.help;
  const required = hint.required === true;

  switch (hint.control) {
    case 'textarea':
      return (
        <Wrapper inputId={inputId} label={label} required={required} description={description}>
          <Textarea
            id={inputId}
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value || undefined)}
            rows={3}
          />
        </Wrapper>
      );
    case 'url':
    case 'email':
      return (
        <Wrapper inputId={inputId} label={label} required={required} description={description}>
          <Input
            id={inputId}
            type={hint.control}
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        </Wrapper>
      );
    case 'number':
      return (
        <Wrapper inputId={inputId} label={label} required={required} description={description}>
          <Input
            id={inputId}
            type="number"
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
          />
        </Wrapper>
      );
    case 'date':
      return (
        <Wrapper inputId={inputId} label={label} required={required} description={description}>
          <Input
            id={inputId}
            type="datetime-local"
            value={formatDateValue(value)}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        </Wrapper>
      );
    case 'switch':
      return (
        <div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value === true}
              onChange={(e) => onChange(e.target.checked)}
              className="w-4 h-4 rounded-md border-grey-09 text-azure-04 focus:ring-azure-04"
            />
            <span className="text-sm font-medium text-grey-01 dark:text-grey-12">
              {label}
              {required && <span className="text-red-04 dark:text-red-08 ml-1">*</span>}
            </span>
          </label>
          {description && <p className="mt-1 text-sm text-grey-04 dark:text-grey-07 ml-6">{description}</p>}
        </div>
      );
    case 'image':
      return (
        <Wrapper inputId={inputId} label={label} required={required} description={description}>
          <ImageFieldRender
            inputId={inputId}
            value={(value as string) || ''}
            onChange={(v) => onChange(v || undefined)}
          />
        </Wrapper>
      );
    case 'select':
      return (
        <Wrapper inputId={inputId} label={label} required={required} description={description}>
          <Select id={inputId} value={(value as string) || ''} onChange={(e) => onChange(e.target.value || undefined)}>
            {!required && <option value="">Select…</option>}
            {hint.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </Wrapper>
      );
    case 'chips':
      return (
        <Wrapper inputId={inputId} label={label} required={required} description={description}>
          <ChipArrayField
            inputId={inputId}
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={(v) => onChange(v)}
          />
        </Wrapper>
      );
    case 'object': {
      const objectValue = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
      return (
        <Wrapper label={label} required={required} description={description}>
          <div className="space-y-4 border-l-2 border-grey-09 pl-3">
            {Object.entries(hint.fields).map(([k, h]) => (
              <HintField
                key={k}
                name={k}
                hint={h}
                value={Object.getOwnPropertyDescriptor(objectValue, k)?.value}
                onChange={(v) => onChange({ ...objectValue, [k]: v })}
              />
            ))}
          </div>
        </Wrapper>
      );
    }
    case 'array':
      return (
        <Wrapper label={label} required={required} description={description}>
          <ArrayField hint={hint.of} value={Array.isArray(value) ? (value as unknown[]) : []} onChange={onChange} />
        </Wrapper>
      );
    case 'variant':
      return (
        <Wrapper label={label} required={required} description={description}>
          <VariantField name={name} variants={hint.variants} value={value} onChange={onChange} />
        </Wrapper>
      );
    default:
      return (
        <Wrapper inputId={inputId} label={label} required={required} description={description}>
          <Input
            id={inputId}
            type="text"
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        </Wrapper>
      );
  }
}

interface VariantFieldProps {
  name: string;
  variants: ReadonlyArray<FieldHintVariant>;
  value: unknown;
  onChange: (value: unknown) => void;
}

function VariantField({ name, variants, value, onChange }: VariantFieldProps) {
  const active = pickVariant(variants, value) ?? variants[0];
  const radioName = `${name}-variant`;

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-3">
        {variants.map((v) => (
          <label key={v.id} className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name={radioName}
              checked={active.id === v.id}
              onChange={() => {
                if (v.control === undefined && 'value' in v) {
                  onChange(v.value);
                } else if (v.control) {
                  onChange(undefined);
                } else {
                  onChange(undefined);
                }
              }}
            />
            <span>{v.label}</span>
          </label>
        ))}
      </div>
      {active.control && (
        <HintField
          name={`${name}.${active.id}`}
          hint={{ control: active.control, ...(active as object) } as FieldHint}
          value={value}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function pickVariant(variants: ReadonlyArray<FieldHintVariant>, value: unknown): FieldHintVariant | null {
  // 1. Literal match — variants that declare a `value` and no `control` win
  //    when the current value equals their literal.
  for (const v of variants) {
    if (v.control === undefined && 'value' in v && v.value === value) return v;
  }
  // 2. Type-shape match — pick the first variant whose control can hold the
  //    current value.
  if (typeof value === 'string') {
    return variants.find((v) => v.control === 'text' || v.control === 'url' || v.control === 'email') ?? null;
  }
  if (typeof value === 'number') {
    return variants.find((v) => v.control === 'number') ?? null;
  }
  if (typeof value === 'boolean') {
    return variants.find((v) => v.control === undefined && v.value === value) ?? null;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return variants.find((v) => v.control === 'object') ?? null;
  }
  if (Array.isArray(value)) {
    return variants.find((v) => v.control === 'array') ?? null;
  }
  return null;
}

interface ArrayFieldProps {
  hint: FieldHint;
  value: unknown[];
  onChange: (value: unknown[]) => void;
}

function ArrayField({ hint, value, onChange }: ArrayFieldProps) {
  const idPrefix = useId();
  const nextItemId = useRef(0);
  const itemIds = useRef<string[]>([]);
  const allocateItemId = () => {
    const itemId = `${idPrefix}-${nextItemId.current}`;
    nextItemId.current += 1;
    return itemId;
  };

  while (itemIds.current.length < value.length) {
    itemIds.current.push(allocateItemId());
  }
  if (itemIds.current.length > value.length) {
    itemIds.current.length = value.length;
  }

  return (
    <div className="space-y-2">
      {itemIds.current.map((itemId, i) => (
        <div key={itemId} className="flex items-start gap-2 border-l-2 border-grey-09 pl-3">
          <div className="flex-1">
            <HintField
              name={`item-${i}`}
              hint={hint}
              value={value[i]}
              onChange={(v) => {
                const next = value.slice();
                next[i] = v;
                onChange(next);
              }}
            />
          </div>
          <button
            type="button"
            className="text-xs text-grey-04 dark:text-grey-07 hover:text-red-04 dark:hover:text-red-08 mt-1"
            onClick={() => {
              itemIds.current.splice(i, 1);
              const next = value.slice();
              next.splice(i, 1);
              onChange(next);
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-sm text-azure-04 dark:text-azure-08 hover:underline"
        onClick={() => {
          itemIds.current.push(allocateItemId());
          onChange([...value, undefined]);
        }}
      >
        + Add item
      </button>
    </div>
  );
}

interface WrapperProps {
  inputId?: string;
  label: string;
  required: boolean;
  description?: string;
  children: React.ReactNode;
}

function Wrapper({ label, required, description, children, inputId }: WrapperProps) {
  const labelContent = (
    <>
      {label}
      {required && <span className="text-red-04 dark:text-red-08 ml-1">*</span>}
    </>
  );

  return (
    <div>
      {inputId ? (
        <label htmlFor={inputId} className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
          {labelContent}
        </label>
      ) : (
        <div className="text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">{labelContent}</div>
      )}
      {children}
      {description && <p className="mt-1 text-sm text-grey-04 dark:text-grey-07">{description}</p>}
    </div>
  );
}

function formatLabel(name: string): string {
  const last = name.includes('.') ? (name.split('.').pop() ?? name) : name;
  return last
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

/**
 * Host date hints store the picker's zone-less digits, which readers take as
 * UTC. Slicing UTC hours off a Date or ISO string keeps the picker on that
 * convention; local hours would shift the stored day across midnight for
 * authors west of UTC.
 */
function formatDateValue(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') {
    if (value.includes('T') && !value.includes('Z')) return value;
    try {
      return new Date(value).toISOString().slice(0, 16);
    } catch {
      return '';
    }
  }
  if (value instanceof Date) return value.toISOString().slice(0, 16);
  return '';
}
