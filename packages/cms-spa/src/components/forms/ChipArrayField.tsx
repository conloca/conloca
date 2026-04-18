import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '../../utils/cn';

interface ChipArrayFieldProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}

/**
 * Chip/pill input for z.array(z.string()) schema fields.
 * Enter or comma adds a chip, Backspace on empty input removes the last chip.
 */
export function ChipArrayField({ value, onChange, placeholder = 'Type and press Enter to add' }: ChipArrayFieldProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addChip = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setInput('');
  };

  const removeChip = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addChip(input);
    } else if (e.key === 'Backspace' && input === '' && value.length > 0) {
      removeChip(value.length - 1);
    }
  };

  const handleContainerClick = () => {
    inputRef.current?.focus();
  };

  return (
    <div
      onClick={handleContainerClick}
      className={cn(
        'flex flex-wrap gap-1.5 p-2 border border-grey-09 dark:border-grey-03 dark:bg-grey-03 rounded',
        'focus-within:ring-2 focus-within:ring-azure-04',
        'min-h-[38px] items-center cursor-text',
      )}
    >
      {value.map((chip, index) => (
        <span
          key={chip}
          className="inline-flex items-center gap-1 bg-azure-10 text-azure-02 border border-azure-08 rounded-full px-2.5 py-0.5 text-sm"
        >
          {chip}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeChip(index);
            }}
            className="hover:bg-azure-08 rounded-full p-0.5 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => addChip(input)}
        placeholder={value.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] outline-none text-sm bg-transparent"
      />
    </div>
  );
}
