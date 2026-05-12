import type { FieldHint, FieldHintVariant, PageSchemaGroup } from '../../page-schemas';
import { ImageFieldRender } from '../fields/ImageField';
import { Input, Select, Textarea } from '../ui';
import { ChipArrayField } from './ChipArrayField';

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

  const renderField = (name: string, hint: FieldHint) => (
    <HintField key={name} name={name} hint={hint} value={values[name]} onChange={(v) => setField(name, v)} />
  );

  if (!groups || groups.length === 0) {
    return (
      <div className={className}>
        <div className="space-y-6">{Object.entries(hints).map(([n, h]) => renderField(n, h))}</div>
      </div>
    );
  }

  const ungrouped: Array<[string, FieldHint]> = [];
  const byGroup = new Map<string, Array<[string, FieldHint]>>();
  for (const [name, hint] of Object.entries(hints)) {
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
        <Wrapper label={label} required={required} description={description}>
          <Textarea value={(value as string) || ''} onChange={(e) => onChange(e.target.value || undefined)} rows={3} />
        </Wrapper>
      );
    case 'url':
    case 'email':
      return (
        <Wrapper label={label} required={required} description={description}>
          <Input
            type={hint.control}
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        </Wrapper>
      );
    case 'number':
      return (
        <Wrapper label={label} required={required} description={description}>
          <Input
            type="number"
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
          />
        </Wrapper>
      );
    case 'date':
      return (
        <Wrapper label={label} required={required} description={description}>
          <Input
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
              checked={(value as boolean) === true}
              onChange={(e) => onChange(e.target.checked)}
              className="w-4 h-4 rounded-md border-grey-09 text-azure-04 focus:ring-azure-04"
            />
            <span className="text-sm font-medium text-grey-01 dark:text-grey-12">
              {label}
              {required && <span className="text-red-04 ml-1">*</span>}
            </span>
          </label>
          {description && <p className="mt-1 text-sm text-grey-04 dark:text-grey-07 ml-6">{description}</p>}
        </div>
      );
    case 'image':
      return (
        <Wrapper label={label} required={required} description={description}>
          <ImageFieldRender value={(value as string) || ''} onChange={(v) => onChange(v || undefined)} />
        </Wrapper>
      );
    case 'select':
      return (
        <Wrapper label={label} required={required} description={description}>
          <Select value={(value as string) || ''} onChange={(e) => onChange(e.target.value || undefined)}>
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
        <Wrapper label={label} required={required} description={description}>
          <ChipArrayField
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={(v) => onChange(v)}
            placeholder={description || 'Type and press Enter to add'}
          />
        </Wrapper>
      );
    case 'object':
      return (
        <Wrapper label={label} required={required} description={description}>
          <div className="space-y-4 border-l-2 border-grey-09 pl-3">
            {Object.entries(hint.fields).map(([k, h]) => (
              <HintField
                key={k}
                name={k}
                hint={h}
                value={(value as Record<string, unknown> | undefined)?.[k]}
                onChange={(v) => onChange({ ...((value as Record<string, unknown>) || {}), [k]: v })}
              />
            ))}
          </div>
        </Wrapper>
      );
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
    case 'markdown':
    case 'code':
    case 'text':
    default:
      return (
        <Wrapper label={label} required={required} description={description}>
          <Input type="text" value={(value as string) || ''} onChange={(e) => onChange(e.target.value || undefined)} />
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
  return (
    <div className="space-y-2">
      {value.map((item, i) => (
        <div key={i} className="flex items-start gap-2 border-l-2 border-grey-09 pl-3">
          <div className="flex-1">
            <HintField
              name={`item-${i}`}
              hint={hint}
              value={item}
              onChange={(v) => {
                const next = value.slice();
                next[i] = v;
                onChange(next);
              }}
            />
          </div>
          <button
            type="button"
            className="text-xs text-grey-04 hover:text-red-04 mt-1"
            onClick={() => {
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
        className="text-sm text-azure-04 hover:underline"
        onClick={() => onChange([...value, undefined])}
      >
        + Add item
      </button>
    </div>
  );
}

interface WrapperProps {
  label: string;
  required: boolean;
  description?: string;
  children: React.ReactNode;
}

function Wrapper({ label, required, description, children }: WrapperProps) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
        {label}
        {required && <span className="text-red-04 ml-1">*</span>}
      </label>
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
