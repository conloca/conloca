import { Loader2 } from 'lucide-react';
import { useId } from 'react';
import type { z } from 'zod';
import { toDatetimeLocalValue } from '../../utils/pageMetadata.js';
import { type FieldInfo, getZodShape } from '../../utils/zodIntrospect.js';
import { ImageFieldRender } from '../fields/ImageField.js';
import { Input, Select, Textarea } from '../ui/index.js';
import { ChipArrayField } from './ChipArrayField.js';

interface SchemaFormProps {
  schema: z.ZodObject<z.ZodRawShape> | null;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  isLoading?: boolean;
  className?: string;
}

/**
 * Renders a form based on a Zod schema.
 * Fields are rendered automatically based on Zod type information.
 */
export function SchemaForm({ schema, values, onChange, isLoading, className }: SchemaFormProps) {
  const handleFieldChange = (field: string, value: unknown) => {
    onChange({ ...values, [field]: value });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-azure-04 dark:text-azure-08" />
      </div>
    );
  }

  if (!schema) {
    return (
      <div className="text-center py-8 text-grey-04 dark:text-grey-07">
        <p>No schema defined.</p>
      </div>
    );
  }

  const fields = getZodShape(schema);

  return (
    <div className={className}>
      <div className="space-y-6">
        {Object.entries(fields).map(([fieldName, fieldInfo]) => (
          // Names the field, so a dialog can open at it (see PageMetadataDialog's focusField).
          <div key={fieldName} data-field-name={fieldName}>
            <SchemaField
              name={fieldName}
              fieldInfo={fieldInfo}
              value={values[fieldName]}
              onChange={(value) => handleFieldChange(fieldName, value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

interface SchemaFieldProps {
  name: string;
  fieldInfo: FieldInfo;
  value: unknown;
  onChange: (value: unknown) => void;
}

function SchemaField({ name, fieldInfo, value, onChange }: SchemaFieldProps) {
  const label = formatFieldLabel(name);
  const inputId = useId();
  const description = fieldInfo.description;
  const required = !fieldInfo.isOptional;

  // Handle datetime fields
  if (fieldInfo.type === 'date' || fieldInfo.format === 'date-time') {
    return (
      <div>
        <label htmlFor={inputId} className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
          {label}
          {required && <span className="text-red-04 dark:text-red-08 ml-1">*</span>}
        </label>
        <Input
          id={inputId}
          type="datetime-local"
          value={formatDateValue(value)}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
        {description && <p className="mt-1 text-sm text-grey-04 dark:text-grey-07">{description}</p>}
      </div>
    );
  }

  // Handle URL fields
  if (fieldInfo.format === 'url') {
    return (
      <div>
        <label htmlFor={inputId} className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
          {label}
          {required && <span className="text-red-04 dark:text-red-08 ml-1">*</span>}
        </label>
        <Input
          id={inputId}
          type="url"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
        {description && <p className="mt-1 text-sm text-grey-04 dark:text-grey-07">{description}</p>}
      </div>
    );
  }

  // Handle email fields
  if (fieldInfo.format === 'email') {
    return (
      <div>
        <label htmlFor={inputId} className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
          {label}
          {required && <span className="text-red-04 dark:text-red-08 ml-1">*</span>}
        </label>
        <Input
          id={inputId}
          type="email"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
        {description && <p className="mt-1 text-sm text-grey-04 dark:text-grey-07">{description}</p>}
      </div>
    );
  }

  // Handle by type
  switch (fieldInfo.type) {
    case 'enum':
      return (
        <div>
          <label htmlFor={inputId} className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
            {label}
            {required && <span className="text-red-04 dark:text-red-08 ml-1">*</span>}
          </label>
          <Select id={inputId} value={(value as string) || ''} onChange={(e) => onChange(e.target.value || undefined)}>
            {!required && <option value="">Select...</option>}
            {fieldInfo.enumValues?.map((enumValue) => (
              <option key={enumValue} value={enumValue}>
                {formatEnumLabel(enumValue)}
              </option>
            ))}
          </Select>
          {description && <p className="mt-1 text-sm text-grey-04 dark:text-grey-07">{description}</p>}
        </div>
      );

    case 'number':
      return (
        <div>
          <label htmlFor={inputId} className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
            {label}
            {required && <span className="text-red-04 dark:text-red-08 ml-1">*</span>}
          </label>
          <Input
            id={inputId}
            type="number"
            value={(value as number) ?? ''}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
          />
          {description && <p className="mt-1 text-sm text-grey-04 dark:text-grey-07">{description}</p>}
        </div>
      );

    case 'boolean':
      return (
        <div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={(value as boolean) || false}
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

    case 'array':
      return (
        <div>
          <label htmlFor={inputId} className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
            {label}
            {required && <span className="text-red-04 dark:text-red-08 ml-1">*</span>}
          </label>
          <ChipArrayField
            inputId={inputId}
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={(newValue) => onChange(newValue)}
          />
          {description && <p className="mt-1 text-sm text-grey-04 dark:text-grey-07">{description}</p>}
        </div>
      );

    default: {
      // Use ImageFieldRender for image URL fields (but not imageDescription, etc.)
      const isImageField = name.toLowerCase().includes('image') && !name.toLowerCase().includes('description');
      if (isImageField) {
        return (
          <div>
            <label htmlFor={inputId} className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
              {label}
              {required && <span className="text-red-04 dark:text-red-08 ml-1">*</span>}
            </label>
            <ImageFieldRender
              inputId={inputId}
              value={(value as string) || ''}
              onChange={(newValue) => onChange(newValue || undefined)}
            />
            {description && <p className="mt-1 text-sm text-grey-04 dark:text-grey-07">{description}</p>}
          </div>
        );
      }

      // Use textarea for description-like fields (based on name heuristic as fallback)
      const isTextarea =
        name.toLowerCase().includes('description') ||
        name.toLowerCase().includes('content') ||
        name.toLowerCase().includes('body');

      if (isTextarea) {
        return (
          <div>
            <label htmlFor={inputId} className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
              {label}
              {required && <span className="text-red-04 dark:text-red-08 ml-1">*</span>}
            </label>
            <Textarea
              id={inputId}
              value={(value as string) || ''}
              onChange={(e) => onChange(e.target.value || undefined)}
              rows={3}
            />
            {description && <p className="mt-1 text-sm text-grey-04 dark:text-grey-07">{description}</p>}
          </div>
        );
      }

      // Default text input
      return (
        <div>
          <label htmlFor={inputId} className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
            {label}
            {required && <span className="text-red-04 dark:text-red-08 ml-1">*</span>}
          </label>
          <Input
            id={inputId}
            type="text"
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
          {description && <p className="mt-1 text-sm text-grey-04 dark:text-grey-07">{description}</p>}
          {fieldInfo.maxLength && (
            <p className="mt-1 text-xs text-grey-06 dark:text-grey-05">
              {((value as string) || '').length}/{fieldInfo.maxLength} characters
            </p>
          )}
        </div>
      );
    }
  }
}

function formatFieldLabel(name: string): string {
  // Convert camelCase/snake_case to Title Case
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

function formatEnumLabel(value: string): string {
  // Convert enum values like "PENDING", "in_progress", "camelCase" to readable labels
  return value
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

function formatDateValue(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') {
    // Page settings already stores wall-clock digits. Leave them alone.
    if (value.includes('T') && !value.includes('Z')) return value;
    return toDatetimeLocalValue(new Date(value));
  }
  if (value instanceof Date) {
    return toDatetimeLocalValue(value);
  }
  return '';
}
