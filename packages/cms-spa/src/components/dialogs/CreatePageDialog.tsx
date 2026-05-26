import { normalizeAndValidatePathname } from '@conloca/content-api-client';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import type { CreatePageData } from '../../types';
import { getUIConfig } from '../../ui-config';
import { slugify } from '../../utils/slugify';
import { Button, IconButton, Input, Select } from '../ui';

interface CreatePageDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreatePage?: (data: CreatePageData) => void;
  site?: string; // Site identifier for pathname validation
}

/**
 * Turn a BCP-47 code like 'en' into a human label like 'English' using
 * the browser's built-in language registry. Falls back to the raw code
 * on platforms where Intl.DisplayNames is unavailable or doesn't
 * recognize the code.
 */
function formatLocaleLabel(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

export function CreatePageDialog({ open, onOpenChange, onCreatePage, site = 'default' }: CreatePageDialogProps) {
  // Get config once so format/locale defaults can read from it
  const config = getUIConfig();
  const templates = config.templates || {};
  const templateEntries = Object.entries(templates);
  const mdxEnabled = Boolean(config.mdxPagesEnabled);
  const configuredLocales = config.locales?.list ?? ['en'];
  const defaultLocale = config.locales?.defaultLocale ?? configuredLocales[0] ?? 'en';

  const [title, setTitle] = useState('');
  const [path, setPath] = useState('');
  const [template, setTemplate] = useState<string>('blank');
  const [locale, setLocale] = useState(defaultLocale);
  // Format: 'puck' (visual editor) or 'mdx' (document page). Default to
  // 'puck' to match prior behavior; the MDX option only renders when
  // at least one site in `sites.json` declares an `mdxPages` path.
  const [format, setFormat] = useState<'puck' | 'mdx'>('puck');
  // Only collected/shown for MDX pages. Optional — leaving it empty is
  // valid; renderers that surface a description use it when present.
  const [description, setDescription] = useState('');

  const [isPathnameAvailable, setIsPathnameAvailable] = useState(true);
  const [pathnameLoading, setPathnameLoading] = useState(false);
  const [showLoadingText, setShowLoadingText] = useState(false);
  const [pathShapeError, setPathShapeError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setIsPathnameAvailable(true);
      setPathnameLoading(false);
      setShowLoadingText(false);
      setPathShapeError(null);
      return;
    }

    // Run shape validation before hitting the network. If the shape is
    // invalid, surface the error inline and skip the availability check —
    // the backend would reject it anyway with the same reason.
    const validation = normalizeAndValidatePathname(path);
    if (!validation.valid) {
      setPathShapeError(validation.message ?? 'Invalid path');
      setIsPathnameAvailable(true);
      setPathnameLoading(false);
      setShowLoadingText(false);
      return;
    }
    setPathShapeError(null);
    const normalized = validation.value;

    // Add a small debounce to avoid rapid consecutive requests
    const timeoutId = setTimeout(async () => {
      setPathnameLoading(true);

      // Show loading text after 500ms delay
      const loadingTextTimeout = setTimeout(() => {
        setShowLoadingText(true);
      }, 500);

      try {
        const config = getUIConfig();
        const baseUrl = config.apiBaseUrl || '/__cms/api';
        const url = `${baseUrl}/${site}/pathname-available?pathname=${encodeURIComponent(normalized)}&locale=${locale}`;
        const response = await fetch(url);
        const text = await response.text();
        try {
          const data = JSON.parse(text);
          setIsPathnameAvailable(data.available);
        } catch (parseError) {
          console.error('[CreatePageDialog] Failed to parse response:', parseError, 'Text was:', text);
          throw parseError;
        }
      } catch (error) {
        console.error('Failed to check pathname availability:', error);
        setIsPathnameAvailable(true); // Assume available on error
      } finally {
        clearTimeout(loadingTextTimeout);
        setPathnameLoading(false);
        setShowLoadingText(false);
      }
    }, 100); // 100ms debounce

    return () => clearTimeout(timeoutId);
  }, [path, site, locale]);

  // Auto-generate path from title, including template prefix if applicable.
  // We read `templates` via getUIConfig() inside the effect so the dep array
  // stays stable — using the component-scope `templates` here would re-run the
  // effect on every render (since `config.templates || {}` creates a fresh
  // empty object each time when no templates are configured), which clobbers
  // manual edits to the path.
  useEffect(() => {
    const slug = slugify(title);
    if (!slug) {
      setPath('');
      return;
    }

    const templateConfig = (getUIConfig().templates ?? {})[template];
    if (templateConfig?.pathPrefix) {
      const prefix = templateConfig.pathPrefix.endsWith('/')
        ? templateConfig.pathPrefix
        : `${templateConfig.pathPrefix}/`;
      setPath(`${prefix}${slug}`);
    } else {
      setPath(`/${slug}`);
    }
  }, [title, template]);

  // Template change handler - path update handled by useEffect above
  const handleTemplateChange = (newTemplate: string) => {
    setTemplate(newTemplate);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Submit the normalized form so silent fixes (missing leading slash,
    // doubled slashes, trailing slash) reach the API.
    const validation = normalizeAndValidatePathname(path);
    if (!validation.valid) {
      setPathShapeError(validation.message ?? 'Invalid path');
      return;
    }
    onCreatePage?.({
      title,
      path: validation.value,
      template,
      locale,
      format,
      // Only forward description when MDX is chosen — Puck pages don't
      // use it today and we want the payload to stay clean.
      ...(format === 'mdx' && description ? { description } : {}),
    });
    onOpenChange?.(false);
  };

  const pathError = Boolean(pathShapeError || (!isPathnameAvailable && path));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-overlay rounded-lg shadow-lg p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto"
          data-testid="create-page-dialog"
        >
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold">Create New Page</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton icon={X} ariaLabel="Close" variant="ghost" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mdxEnabled && (
              <div>
                <span className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12" id="format-label">
                  Format
                </span>
                <div
                  className="inline-flex rounded-md border border-grey-09 dark:border-grey-05 overflow-hidden"
                  role="radiogroup"
                  aria-labelledby="format-label"
                  data-testid="page-format-radiogroup"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={format === 'puck'}
                    onClick={() => setFormat('puck')}
                    className={`px-3 py-1.5 text-sm transition-colors ${
                      format === 'puck'
                        ? 'bg-azure-04 text-white dark:bg-azure-06'
                        : 'bg-transparent text-grey-01 dark:text-grey-12 hover:bg-grey-11 dark:hover:bg-grey-04/40'
                    }`}
                    data-testid="page-format-puck"
                  >
                    Visual page
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={format === 'mdx'}
                    onClick={() => setFormat('mdx')}
                    className={`px-3 py-1.5 text-sm transition-colors border-l border-grey-09 dark:border-grey-05 ${
                      format === 'mdx'
                        ? 'bg-azure-04 text-white dark:bg-azure-06'
                        : 'bg-transparent text-grey-01 dark:text-grey-12 hover:bg-grey-11 dark:hover:bg-grey-04/40'
                    }`}
                    data-testid="page-format-mdx"
                  >
                    Document page (MDX)
                  </button>
                </div>
                <p className="text-xs text-grey-04 dark:text-grey-07 mt-1">
                  {format === 'puck' ? 'Drag-and-drop blocks on a canvas.' : 'Markdown page rendered by the host site.'}
                </p>
              </div>
            )}

            <div>
              <label htmlFor="title" className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
                Title
              </label>
              <Input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                required
                data-testid="page-title-input"
              />
            </div>

            {format === 'mdx' && (
              <div>
                <label htmlFor="description" className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
                  Description <span className="text-grey-04 dark:text-grey-07 font-normal">(optional)</span>
                </label>
                <Input
                  id="description"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.currentTarget.value)}
                  data-testid="page-description-input"
                />
                <p className="text-xs text-grey-04 dark:text-grey-07 mt-1">
                  Shown in search results and at the top of the page. You can edit it later in the frontmatter.
                </p>
              </div>
            )}

            <div>
              <label htmlFor="path" className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
                URL Path
              </label>
              <div className="relative">
                <Input
                  id="path"
                  type="text"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  error={pathError}
                  required
                  data-testid="page-path-input"
                />
                {pathError && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <AlertCircle className="h-5 w-5 text-red-04" />
                  </div>
                )}
              </div>
              <div className="h-5 mt-1">
                {pathShapeError && <p className="text-sm text-red-04">{pathShapeError}</p>}
                {!pathShapeError && !isPathnameAvailable && path && (
                  <p className="text-sm text-red-04">This pathname is already in use</p>
                )}
                {!pathShapeError && pathnameLoading && showLoadingText && path && (
                  <p className="text-sm text-grey-04 dark:text-grey-07">Checking availability...</p>
                )}
              </div>
            </div>

            {format === 'puck' && (
              <div>
                <label htmlFor="template" className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
                  Template
                </label>
                <Select id="template" value={template} onChange={(e) => handleTemplateChange(e.target.value)}>
                  <option value="blank">Blank</option>
                  {templateEntries.map(([key, templateConfig]) => (
                    <option key={key} value={key}>
                      {templateConfig.label}
                      {templateConfig.description ? ` - ${templateConfig.description}` : ''}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {configuredLocales.length > 1 && (
              <div>
                <label htmlFor="locale" className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
                  Primary Locale
                </label>
                <Select id="locale" value={locale} onChange={(e) => setLocale(e.target.value)}>
                  {configuredLocales.map((code) => (
                    <option key={code} value={code}>
                      {formatLocaleLabel(code)}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div className="flex gap-2 pt-4">
              <Button
                type="submit"
                variant="primary"
                disabled={Boolean(pathShapeError) || !isPathnameAvailable || pathnameLoading || !title || !path}
                className="flex-1"
                data-testid="create-page-submit"
              >
                Create
              </Button>
              <Dialog.Close asChild>
                <Button variant="outline" className="flex-1">
                  Cancel
                </Button>
              </Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
