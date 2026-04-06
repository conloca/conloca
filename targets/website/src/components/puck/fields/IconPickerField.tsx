import { useEffect, useState } from 'react';

/**
 * Curated icon presets for feature cards.
 * Each entry is a Lucide-style SVG path rendered in a 24x24 viewBox
 * with stroke="currentColor" strokeWidth="1.5".
 */
const iconPresets = [
  // Files & Storage
  { id: 'folder', label: 'Folder', path: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
  {
    id: 'file-text',
    label: 'Document',
    path: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  },
  {
    id: 'database',
    label: 'Database',
    path: 'M12 2C6.5 2 2 4.2 2 7v10c0 2.8 4.5 5 10 5s10-2.2 10-5V7c0-2.8-4.5-5-10-5zM2 12c0 2.8 4.5 5 10 5s10-2.2 10-5M2 7c0 2.8 4.5 5 10 5s10-2.2 10-5',
  },
  {
    id: 'hard-drive',
    label: 'Storage',
    path: 'M22 12H2M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11zM6 16h.01M10 16h.01',
  },

  // Code & Dev
  { id: 'code', label: 'Code', path: 'M16 18l6-6-6-6M8 6l-6 6 6 6' },
  { id: 'terminal', label: 'Terminal', path: 'M4 17l6-6-6-6M12 19h8' },
  {
    id: 'git-branch',
    label: 'Git Branch',
    path: 'M6 3v12M18 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM18 9a9 9 0 01-9 9',
  },
  {
    id: 'git-merge',
    label: 'Git Merge',
    path: 'M18 21a3 3 0 100-6 3 3 0 000 6zM6 9a3 3 0 100-6 3 3 0 000 6zM6 9v12M18 18c0-5-4-9-9-9',
  },

  // UI & Layout
  {
    id: 'layout',
    label: 'Layout',
    path: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z',
  },
  { id: 'grid', label: 'Grid', path: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z' },
  {
    id: 'palette',
    label: 'Palette',
    path: 'M12 2a10 10 0 000 20 2 2 0 002-2v-1a2 2 0 012-2h1a2 2 0 002-2 10 10 0 00-7-13zM8.5 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM12.5 7a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM16.5 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM9 13.5a1.5 1.5 0 10-3 0 1.5 1.5 0 003 0z',
  },
  { id: 'eye', label: 'Preview', path: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 100 6 3 3 0 000-6z' },

  // Performance & Speed
  { id: 'zap', label: 'Lightning', path: 'M13 10V3L4 14h7v7l9-11h-7z' },
  {
    id: 'rocket',
    label: 'Rocket',
    path: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09zM12 15l-3-3a22 22 0 015-10 22 22 0 015 10l-3-3M9 12a1 1 0 10-2 0 1 1 0 002 0zM15 12a1 1 0 10-2 0 1 1 0 002 0z',
  },
  { id: 'gauge', label: 'Performance', path: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2' },

  // Security & Auth
  { id: 'shield', label: 'Shield', path: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
  {
    id: 'lock',
    label: 'Lock',
    path: 'M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2zM7 11V7a5 5 0 0110 0v4',
  },
  {
    id: 'key',
    label: 'Key',
    path: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  },

  // Network & Cloud
  {
    id: 'globe',
    label: 'Globe',
    path: 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  { id: 'cloud', label: 'Cloud', path: 'M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z' },
  { id: 'server', label: 'Server', path: 'M2 4h20v5H2zM2 15h20v5H2zM6 6.5h.01M6 17.5h.01' },

  // Content & Media
  {
    id: 'image',
    label: 'Image',
    path: 'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21',
  },
  {
    id: 'edit',
    label: 'Edit',
    path: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z',
  },
  { id: 'type', label: 'Typography', path: 'M4 7V4h16v3M9 20h6M12 4v16' },

  // Misc
  {
    id: 'puzzle',
    label: 'Plugin',
    path: 'M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 01-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 10-3.214 3.214c.446.166.855.497.925.968a.979.979 0 01-.276.837l-1.61 1.61a2.404 2.404 0 01-1.705.707 2.402 2.402 0 01-1.704-.706l-1.568-1.568a1.026 1.026 0 00-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 11-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 00-.289-.877l-1.568-1.568A2.402 2.402 0 011.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 103.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0112 2c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 113.237 3.237c-.464.18-.894.527-.967 1.02z',
  },
  {
    id: 'settings',
    label: 'Settings',
    path: 'M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2zM12 9a3 3 0 100 6 3 3 0 000-6z',
  },
  {
    id: 'users',
    label: 'Users',
    path: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  },
  { id: 'check-circle', label: 'Check', path: 'M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3' },
  {
    id: 'refresh',
    label: 'Refresh',
    path: 'M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15',
  },
  { id: 'layers', label: 'Layers', path: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
] as const;

interface IconPickerFieldProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

export function IconPickerFieldRender({ value, onChange, readOnly }: IconPickerFieldProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [localValue, setLocalValue] = useState(value || '');

  useEffect(() => {
    setLocalValue(value || '');
  }, [value]);

  const selectedPreset = iconPresets.find((p) => p.path === value);

  const handleTextBlur = () => {
    if (localValue !== value) {
      onChange(localValue);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Current icon preview */}
      {value && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              background: 'rgba(6, 182, 212, 0.1)',
              border: '1px solid rgba(6, 182, 212, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: '#06b6d4' }}
            >
              <path d={value} />
            </svg>
          </div>
          <span style={{ fontSize: 12, color: '#6b7280' }}>{selectedPreset?.label || 'Custom icon'}</span>
        </div>
      )}

      {/* Icon grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          gap: '4px',
        }}
      >
        {iconPresets.map((icon) => (
          <button
            key={icon.id}
            type="button"
            title={icon.label}
            aria-label={icon.label}
            aria-pressed={value === icon.path}
            disabled={readOnly}
            onClick={() => {
              onChange(icon.path);
              setLocalValue(icon.path);
            }}
            style={{
              width: '100%',
              aspectRatio: '1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              border: value === icon.path ? '2px solid #06b6d4' : '1px solid var(--puck-color-grey-09, #e5e7eb)',
              background: value === icon.path ? 'rgba(6, 182, 212, 0.08)' : 'transparent',
              cursor: readOnly ? 'not-allowed' : 'pointer',
              padding: 0,
              ...(readOnly ? { pointerEvents: 'none' as const, opacity: 0.6 } : {}),
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: value === icon.path ? '#06b6d4' : '#6b7280' }}
            >
              <path d={icon.path} />
            </svg>
          </button>
        ))}
      </div>

      {/* Advanced toggle */}
      <button
        type="button"
        aria-expanded={showAdvanced}
        onClick={() => setShowAdvanced(!showAdvanced)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 11,
          color: '#6b7280',
          textAlign: 'left',
          padding: '2px 0',
        }}
      >
        {showAdvanced ? '▾ Hide custom SVG path' : '▸ Custom SVG path'}
      </button>

      {/* Advanced: raw SVG path input */}
      {showAdvanced && (
        <textarea
          aria-label="Custom SVG path"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleTextBlur}
          disabled={readOnly}
          placeholder="M3 7v10a2 2 0 002 2h14..."
          rows={3}
          style={{
            width: '100%',
            padding: '6px 8px',
            fontSize: 12,
            fontFamily: 'monospace',
            border: '1px solid var(--puck-color-grey-09, #ccc)',
            borderRadius: 4,
            resize: 'vertical',
            ...(readOnly ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
          }}
        />
      )}
    </div>
  );
}
