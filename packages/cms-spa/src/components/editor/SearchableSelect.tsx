import { useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * Searchable select widget for props with large enum option lists
 * (Starlight's `<Icon>` ships ~270 options; a plain `<select>` is
 * "scroll forever, squint" UX). Renders a text input the author can
 * type into to filter, with the matching options as a popover list
 * below. Keyboard nav (↑↓ to move, Enter to commit, Esc to revert).
 *
 * Use over `<select>` when `options.length > ~20` — below that the
 * native control is fine and brings free a11y + platform behavior.
 *
 * Commits immediately on selection. The selection event is discrete
 * (click or Enter), so unlike the text-input case there's no focus-
 * loss-per-keystroke issue to design around.
 *
 * Filtering is case-insensitive substring on the `label` field, with
 * `value` as a secondary search target (so authors can type `star` to
 * find an icon whose label is "Star (filled)" or whose value happens
 * to be `star`). Limited to 200 visible results to keep the popover
 * scroll length sane on huge lists.
 */
interface Option {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: ReadonlyArray<Option>;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}

const MAX_VISIBLE = 200;

export function SearchableSelect({ options, value, onChange, placeholder, ariaLabel }: SearchableSelectProps) {
  // The current "display" value is the label of the selected option,
  // OR the raw value when no option matches (handles freshly-set or
  // hand-edited values that aren't in the enum yet).
  const selectedLabel = useMemo(() => {
    const hit = options.find((o) => o.value === value);
    return hit ? hit.label : value;
  }, [options, value]);

  // Local query state — what's actually typed in the input. Starts
  // empty (showing selectedLabel as placeholder-y text) when the
  // popover is closed; tracks the user's filter input when open.
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  // Filtered options based on the typed query. Empty query → all
  // options (so the popover acts like a plain dropdown on focus
  // without typing). Cap at MAX_VISIBLE to bound the DOM size for
  // very large enums.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, MAX_VISIBLE);
    const matches = options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
    return matches.slice(0, MAX_VISIBLE);
  }, [options, query]);

  // Reset active index whenever the filtered list changes — keeps the
  // highlight on a row that actually exists. Without this, navigating
  // could land on an index beyond the new list length.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Close on outside click. Use mousedown not click so a click on a
  // list item still fires its onClick before we close (click ordering
  // would otherwise teardown the popover before the selection runs).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Scroll the active row into view as the user arrow-keys through.
  // Block: 'nearest' avoids jumping the page when the popover is already
  // in view; only nudges if the highlighted row sits outside the
  // visible scrollport.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const row = listRef.current.children[activeIndex] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const commitOption = (opt: Option) => {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  return (
    <div ref={rootRef} className="conloca-searchable-select">
      <input
        ref={inputRef}
        type="text"
        // When the popover is open, the input shows the query (filter).
        // When closed, it shows the selected label so the author can
        // see what's currently set without opening the popover.
        value={open ? query : selectedLabel}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          // Clear query on focus so the full list is visible — author
          // can scroll or start typing fresh. The displayed label
          // restores on blur if nothing is committed.
          setQuery('');
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) setOpen(true);
            setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const opt = filtered[activeIndex];
            if (opt) commitOption(opt);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
            setQuery('');
            inputRef.current?.blur();
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        role="combobox"
      />
      {open && filtered.length > 0 && (
        <ul ref={listRef} id={listboxId} role="listbox" className="conloca-searchable-select__list">
          {filtered.map((opt, i) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={i === activeIndex}
              className={
                i === activeIndex
                  ? 'conloca-searchable-select__option conloca-searchable-select__option--active'
                  : 'conloca-searchable-select__option'
              }
              // mousedown not click so we commit before the input loses
              // focus and the outside-click handler tries to close us.
              onMouseDown={(e) => {
                e.preventDefault();
                commitOption(opt);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
      {open && filtered.length === 0 && (
        <div className="conloca-searchable-select__empty">No matches{query ? ` for "${query}"` : ''}</div>
      )}
    </div>
  );
}
