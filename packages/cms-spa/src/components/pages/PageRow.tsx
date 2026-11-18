import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import cn from 'clsx';
import { Check, ChevronDown, CircleAlert, Clock, Copy, Eye, FileCode, FileText, MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Page } from '../../types.js';
import { pageStatusLabel } from '../../ui-config.js';
import { formatDate } from '../../utils/format-date.js';
import { Button } from '../ui/index.js';

const STATUS_LABEL = { draft: 'Draft', scheduled: 'Scheduled', published: 'Published' };

const STATUS_PILL = {
  draft: 'bg-grey-11 text-grey-02 dark:bg-grey-03 dark:text-grey-09',
  scheduled: 'bg-yellow-11 text-yellow-02 dark:bg-yellow-02 dark:text-yellow-09',
  published: 'bg-green-11 text-green-02 dark:bg-green-02 dark:text-green-09',
};

/** Opens the first page locale by default and keeps every version available in the menu. */
function EditPageControl({ page, onEdit }: { page: Page; onEdit: (locale: string) => void }) {
  return (
    <div className={cn('inline-flex')}>
      {/* The primary action always opens the first version; other locales stay in the menu. */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onEdit(page.locales[0])}
        className={cn('rounded-r-none')}
        data-testid={`edit-${page.id}`}
      >
        Edit
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn('rounded-l-none border-l-0 px-2')}
            aria-label={`Choose locale for ${page.title}`}
            data-testid={`edit-locales-${page.id}`}
          >
            <ChevronDown className={cn('h-4 w-4')} aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className={cn(
              'z-50 min-w-40 max-h-72 overflow-auto rounded-md border border-line bg-panel py-1 text-sm text-foreground shadow-md',
            )}
          >
            {page.locales.map((locale) => (
              <DropdownMenu.Item
                key={locale}
                onSelect={() => onEdit(locale)}
                className={cn('cursor-default px-3 py-1.5 outline-none data-[highlighted]:bg-selected')}
              >
                {locale}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

/** Chooses whole-page or locale deletion; the parent validates and confirms the requested operation. */
function PageDeleteMenu({ page, onDelete }: Pick<PageRowProps, 'page' | 'onDelete'>) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn('px-2')}
          aria-label={`More actions for ${page.title}`}
          data-testid={`page-actions-${page.id}`}
        >
          <MoreHorizontal className={cn('h-4 w-4')} aria-hidden />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className={cn(
            'z-50 min-w-40 max-h-72 overflow-auto rounded-md border border-line bg-panel py-1 text-sm text-foreground shadow-md',
          )}
        >
          <DropdownMenu.Item
            onSelect={() => onDelete(page.id)}
            className={cn('cursor-default px-3 py-1.5 outline-none data-[highlighted]:bg-selected')}
          >
            Delete
          </DropdownMenu.Item>
          <DropdownMenu.Separator className={cn('my-1 h-px bg-hover')} />
          {page.locales.map((locale) => (
            <DropdownMenu.Item
              key={locale}
              onSelect={() => onDelete(page.id, locale)}
              className={cn('cursor-default px-3 py-1.5 outline-none data-[highlighted]:bg-selected')}
            >
              Delete {locale} version
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Preserve path copying while the row's editor button covers its text. */
function CopyPathButton({ path, title }: { path: string; title: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'pending' | 'copied' | 'failed'>('idle');
  const pending = useRef(false);
  useEffect(() => {
    // Feedback describes this attempt for two seconds; each row owns its expiry.
    const timer =
      copyState === 'copied' || copyState === 'failed'
        ? window.setTimeout(() => setCopyState('idle'), 2000)
        : undefined;
    return () => window.clearTimeout(timer);
  }, [copyState]);
  const copyPath = async () => {
    if (pending.current) return;
    pending.current = true;
    setCopyState('pending');
    try {
      await navigator.clipboard.writeText(path);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    } finally {
      pending.current = false;
    }
  };
  const message =
    copyState === 'copied' ? 'Copied page path.' : copyState === 'failed' ? 'Could not copy the path. Try again.' : '';
  return (
    <>
      <button
        type="button"
        onClick={copyPath}
        aria-disabled={copyState === 'pending'}
        className="p-1 hover:bg-hover rounded-md transition-colors"
        title={message || 'Copy path'}
        aria-label={`Copy path for ${title}`}
      >
        {copyState === 'copied' ? (
          <Check className="h-4 w-4 text-grey-04 dark:text-grey-07" />
        ) : copyState === 'failed' ? (
          <CircleAlert aria-label="Copy failed" className="h-4 w-4 text-red-04 dark:text-red-08" />
        ) : (
          <Copy className="h-4 w-4 text-grey-04 dark:text-grey-07" />
        )}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
    </>
  );
}

interface PageRowProps {
  page: Page;
  selectedLocale: string;
  isMultiLocale: boolean;
  onPreview: (path: string) => void;
  onDelete: (pageId: string, locale?: string) => void;
  /** Short notes the host gives this page, shown under its title. */
  notes?: string[];
}

/**
 * One row of the Pages list. The row opens the page editor: the title is its button, and that button's
 * `::after` overlay stretches over the whole row. An identity transform supplies its containing block even
 * when an engine ignores positioning on table rows, so a click anywhere on the row
 * opens it, and Enter or Space on the focused title does too. The actions sit above the overlay, but only
 * their buttons take pointer events, so the gaps between them stay part of the row. The table wrapper
 * isolates the stacking context, so the raised actions never paint over dialogs.
 */
export function PageRow({ page, isMultiLocale, onPreview, onDelete, notes = [] }: PageRowProps) {
  const navigate = useNavigate();
  const openEditor = (locale: string) => {
    void navigate(`/pages/${page.id}?locale=${encodeURIComponent(locale)}`);
  };
  const statusLabel = pageStatusLabel(page.status, STATUS_LABEL[page.status]);

  return (
    <tr className="relative [transform:translate(0)] border-b border-grey-10 dark:border-grey-03 hover:bg-grey-11 dark:hover:bg-grey-04/40 transition-colors">
      <td className="p-4">
        <div className="flex items-center gap-2 min-w-0">
          {page.type === 'mdx' ? (
            <FileCode className="h-4 w-4 text-azure-04 dark:text-azure-06" aria-label="MDX page" />
          ) : (
            <FileText className="h-4 w-4 text-grey-04 dark:text-grey-07" aria-label="Puck page" />
          )}
          <button
            type="button"
            onClick={() => openEditor(page.locales[0])}
            className="min-w-0 break-words font-medium text-left text-grey-01 dark:text-grey-12 hover:text-azure-04 dark:hover:text-azure-06 hover:underline transition-colors after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-azure-04"
            data-testid={`page-title-${page.id}`}
          >
            {page.title}
          </button>
          {page.type === 'mdx' && (
            <span
              className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider bg-azure-11 text-azure-02 dark:bg-azure-02/40 dark:text-azure-09 rounded"
              aria-hidden
            >
              MDX
            </span>
          )}
        </div>
        {notes.length > 0 ? (
          <ul className={cn('mt-1 flex flex-wrap gap-1')} data-testid={`page-notes-${page.id}`}>
            {notes.map((note) => (
              <li
                key={note}
                className={cn('px-1.5 py-0.5 text-[11px] rounded bg-subtle text-grey-03 dark:text-grey-09')}
              >
                {note}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="md:hidden mt-1 flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs text-grey-04 dark:text-grey-07 truncate">{page.path}</span>
          <span
            className={cn(
              'inline-flex h-5 px-2 items-center rounded-full text-[11px] font-medium whitespace-nowrap shrink-0',
              STATUS_PILL[page.status],
            )}
          >
            {statusLabel}
          </span>
        </div>
      </td>
      <td className="hidden lg:table-cell p-4">
        <span className="text-grey-04 dark:text-grey-07 font-mono text-xs">{page.path}</span>
      </td>
      <td className="hidden md:table-cell p-4">
        <span
          className={cn(
            'inline-flex h-5 px-2 items-center rounded-full text-[11px] font-medium whitespace-nowrap',
            STATUS_PILL[page.status],
          )}
        >
          {statusLabel}
        </span>
      </td>
      <td className="hidden md:table-cell p-4 text-grey-04 dark:text-grey-07">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          {formatDate(page.modified)}
        </div>
      </td>
      {isMultiLocale && (
        <td className="hidden md:table-cell p-4">
          <div className="flex gap-1">
            {page.locales.map((locale) => (
              <span key={locale} className="px-2 py-1 text-xs bg-subtle rounded-md" data-testid="locale-indicator">
                {locale}
              </span>
            ))}
          </div>
        </td>
      )}
      <td className="p-4">
        <div className="relative z-10 flex flex-wrap gap-2 items-center pointer-events-none [&_button]:pointer-events-auto">
          <button
            type="button"
            onClick={() => onPreview(page.path)}
            className="p-1 hover:bg-hover rounded-md transition-colors"
            title="Preview"
            aria-label={`Preview ${page.title}`}
            data-testid={`preview-${page.id}`}
          >
            <Eye className="h-4 w-4 text-grey-04 dark:text-grey-07" />
          </button>
          <CopyPathButton key={page.path} path={page.path} title={page.title} />
          <EditPageControl page={page} onEdit={openEditor} />
          <PageDeleteMenu page={page} onDelete={onDelete} />
        </div>
      </td>
    </tr>
  );
}
