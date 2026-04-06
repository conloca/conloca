import { useEffect, useState } from 'react';

interface ArrayTextareaFieldProps {
  value: string[];
  onChange: (value: string[]) => void;
  expectedCount?: number;
  expectedCountLabel?: string;
  placeholder?: string;
}

/**
 * Custom field that edits a string array as a textarea (one item per line).
 * Optionally validates that the number of items matches an expected count.
 */
export function ArrayTextareaFieldRender({
  value,
  onChange,
  expectedCount,
  expectedCountLabel,
  placeholder,
}: ArrayTextareaFieldProps) {
  const textValue = Array.isArray(value) ? value.join('\n') : '';
  const [localValue, setLocalValue] = useState(textValue);

  useEffect(() => {
    const newTextValue = Array.isArray(value) ? value.join('\n') : '';
    setLocalValue(newTextValue);
  }, [value]);

  const handleBlur = () => {
    const lines = localValue
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    onChange(lines);
  };

  const lineCount = localValue
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean).length;
  const hasMismatch = expectedCount !== undefined && lineCount > 0 && lineCount !== expectedCount;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <textarea
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder || 'One item per line'}
        rows={4}
        style={{
          width: '100%',
          padding: '6px 8px',
          fontSize: 14,
          border: `1px solid ${hasMismatch ? '#f59e0b' : 'var(--puck-color-grey-09, #ccc)'}`,
          borderRadius: 4,
          resize: 'vertical',
          fontFamily: 'inherit',
        }}
      />
      {hasMismatch && (
        <p
          style={{
            margin: 0,
            fontSize: 11,
            color: '#d97706',
            lineHeight: 1.4,
          }}
        >
          ! {lineCount} {lineCount === 1 ? 'value' : 'values'} entered, but {expectedCount}{' '}
          {expectedCountLabel || 'expected'}.
          {lineCount < expectedCount ? ' Missing values will appear as empty cells.' : ' Extra values will be ignored.'}
        </p>
      )}
    </div>
  );
}
