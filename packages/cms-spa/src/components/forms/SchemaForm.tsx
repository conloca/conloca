import { Loader2 } from 'lucide-react';
import type { z } from 'zod';
import { type FieldInfo, getZodShape } from '../../utils/zodIntrospect';
import { ImageFieldRender } from '../fields/ImageField';
import { Input, Select, Textarea } from '../ui';
import { ChipArrayField } from './ChipArrayField';

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
        <Loader2 className="h-6 w-6 animate-spin text-azure-04" />
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
          <SchemaField
            key={fieldName}
            name={fieldName}
            fieldInfo={fieldInfo}
            value={values[fieldName]}
            onChange={(value) => handleFieldChange(fieldName, value)}
          />
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
  const description = fieldInfo.description;
  const required = !fieldInfo.isOptional;

  // Handle datetime fields
  if (fieldInfo.type === 'date' || fieldInfo.format === 'date-time') {
    return (
      <div>
        <label className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
          {label}
          {required && <span className="text-red-04 ml-1">*</span>}
        </label>
        <Input
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
        <label className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
          {label}
          {required && <span className="text-red-04 ml-1">*</span>}
        </label>
        <Input type="url" value={(value as string) || ''} onChange={(e) => onChange(e.target.value || undefined)} />
        {description && <p className="mt-1 text-sm text-grey-04 dark:text-grey-07">{description}</p>}
      </div>
    );
  }

  // Handle email fields
  if (fieldInfo.format === 'email') {
    return (
      <div>
        <label className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
          {label}
          {required && <span className="text-red-04 ml-1">*</span>}
        </label>
        <Input type="email" value={(value as string) || ''} onChange={(e) => onChange(e.target.value || undefined)} />
        {description && <p className="mt-1 text-sm text-grey-04 dark:text-grey-07">{description}</p>}
      </div>
    );
  }

  // Handle by type
  switch (fieldInfo.type) {
    case 'enum':
      return (
        <div>
          <label className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
            {label}
            {required && <span className="text-red-04 ml-1">*</span>}
          </label>
          <Select value={(value as string) || ''} onChange={(e) => onChange(e.target.value || undefined)}>
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
          <label className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
            {label}
            {required && <span className="text-red-04 ml-1">*</span>}
          </label>
          <Input
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
              {required && <span className="text-red-04 ml-1">*</span>}
            </span>
          </label>
          {description && <p className="mt-1 text-sm text-grey-04 dark:text-grey-07 ml-6">{description}</p>}
        </div>
      );

    case 'array':
      return (
        <div>
          <label className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
            {label}
            {required && <span className="text-red-04 ml-1">*</span>}
          </label>
          <ChipArrayField
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={(newValue) => onChange(newValue)}
            placeholder={description || 'Type and press Enter to add'}
          />
          {description && <p className="mt-1 text-sm text-grey-04 dark:text-grey-07">{description}</p>}
        </div>
      );

    case 'string':
    default: {
      // Use ImageFieldRender for image URL fields (but not imageDescription, etc.)
      const isImageField = name.toLowerCase().includes('image') && !name.toLowerCase().includes('description');
      if (isImageField) {
        return (
          <div>
            <label className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
              {label}
              {required && <span className="text-red-04 ml-1">*</span>}
            </label>
            <ImageFieldRender
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
            <label className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
              {label}
              {required && <span className="text-red-04 ml-1">*</span>}
            </label>
            <Textarea
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
          <label className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
            {label}
            {required && <span className="text-red-04 ml-1">*</span>}
          </label>
          <Input type="text" value={(value as string) || ''} onChange={(e) => onChange(e.target.value || undefined)} />
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
    // If already in datetime-local format, return as-is
    if (value.includes('T') && !value.includes('Z')) return value;
    // Convert ISO string to datetime-local format
    try {
      const date = new Date(value);
      return date.toISOString().slice(0, 16);
    } catch {
      return '';
    }
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 16);
  }
  return '';
}
