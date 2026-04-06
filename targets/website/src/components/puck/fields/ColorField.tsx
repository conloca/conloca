import { useEffect, useState } from 'react';

interface ColorFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  readOnly?: boolean;
}

const hexPattern = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeHex(value: string): string {
  if (!value) return '#000000';
  if (hexPattern.test(value)) {
    // Expand shorthand (#abc → #aabbcc) for the native color input
    if (value.length === 4) {
      return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
    }
    return value;
  }
  return '#000000';
}

export function ColorFieldRender({ value, onChange, readOnly }: ColorFieldProps) {
  const [localValue, setLocalValue] = useState(value || '');

  useEffect(() => {
    setLocalValue(value || '');
  }, [value]);

  const handleTextBlur = () => {
    if (localValue !== value) {
      onChange(localValue);
    }
  };

  const handlePickerChange = (hex: string) => {
    setLocalValue(hex);
    onChange(hex);
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        ...(readOnly ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
      }}
    >
      <input
        type="color"
        aria-label="Pick color"
        value={normalizeHex(localValue)}
        onChange={(e) => handlePickerChange(e.target.value)}
        disabled={readOnly}
        style={{
          width: 32,
          height: 32,
          padding: 0,
          border: '1px solid var(--puck-color-grey-09, #ccc)',
          borderRadius: 4,
          cursor: readOnly ? 'not-allowed' : 'pointer',
          background: 'transparent',
        }}
      />
      <input
        type="text"
        aria-label="Hex color value"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleTextBlur}
        disabled={readOnly}
        placeholder="#000000"
        style={{
          flex: 1,
          padding: '6px 8px',
          fontSize: 14,
          border: '1px solid var(--puck-color-grey-09, #ccc)',
          borderRadius: 4,
          fontFamily: 'monospace',
        }}
      />
    </div>
  );
}
