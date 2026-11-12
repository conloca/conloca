import {
  getContentAPIClient,
  normalizeAndValidatePathname,
  type PathnameValidationResult,
} from '@conloca/content-api-client';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { usePuckConfig } from '../../puck-config.js';
import type { CreatePageData } from '../../types.js';
import { getUIConfig } from '../../ui-config.js';
import { slugify } from '../../utils/slugify.js';
import { Button, IconButton, Input, Select } from '../ui/index.js';

interface CreatePageDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreatePage?: (data: CreatePageData) => void;
  site?: string; // Site identifier for pathname validation
}

/** The answer of the latest pathname check; only 'available' lets the page be created. */
type PathnameCheck = 'available' | 'taken' | 'failed';

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

/**
 * The path a new page is created at: the typed path, tidied, under the template's `pathPrefix`
 * when it is not already under it. The availability check and the create both use it, so the
 * dialog never checks one path while the page is created at another.
 */
function newPagePath(typed: PathnameValidationResult, pathPrefix: string | undefined): PathnameValidationResult {
  if (!typed.valid || !pathPrefix) return typed;
  const prefix = prefixOf(pathPrefix);
  if (isUnder(typed.value, prefix)) return typed;
  // The prefix comes from the site's config: tidy and check the joined path as a typed one.
  return normalizeAndValidatePathname(`${prefix}${typed.value}`);
}

/** A template's `pathPrefix` as the paths under it start, without the trailing slash: '/blog/' is '/blog'. */
function prefixOf(pathPrefix: string | undefined): string {
  return pathPrefix?.endsWith('/') ? pathPrefix.slice(0, -1) : (pathPrefix ?? '');
}

/** Under the prefix means the prefix itself or below it: '/blogging' is not under '/blog'. */
function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * `path` under the `to` template prefix instead of the `from` one when it is under `from`, as a path
 * made from the title would be: '/blog/hello-2' goes from '/blog/' to '/news/' as '/news/hello-2'.
 * The path is judged tidied, as `newPagePath` judges it: 'blog/hello-2' is under '/blog/' too.
 */
function movePathPrefix(path: string, from: string | undefined, to: string | undefined): string {
  const oldPrefix = prefixOf(from);
  const tidied = normalizeAndValidatePathname(path);
  if (!oldPrefix || !tidied.valid || !isUnder(tidied.value, oldPrefix)) return path;
  return `${prefixOf(to)}${tidied.value.slice(oldPrefix.length)}` || '/';
}

const warnedTemplateComponents = new Set<string>();
function warnUnknownTemplateComponentOnce(key: string, component: string, registered: string[]): void {
  if (warnedTemplateComponents.has(key)) return;
  warnedTemplateComponents.add(key);
  console.warn(
    `[conloca] template '${key}' names component '${component}', which is not in the Puck config — ` +
      `the template is hidden from the create dialog. Registered components: ${registered.join(', ')}`,
  );
}

export function CreatePageDialog({ open, onOpenChange, onCreatePage, site = 'default' }: CreatePageDialogProps) {
  // Get config once so format/locale defaults can read from it
  const config = getUIConfig();
  const templates = config.templates || {};
  // A typo in templates.<key>.component fails silently otherwise: the dialog
  // offers the template, creating from it scaffolds a component Puck cannot
  // render, and nothing names the mistake. Offer only templates whose
  // component is registered, and say which ones were dropped and why.
  // The shared config defaults to `{ components: {} }` until the host installs
  // the real one (a host app may do so asynchronously) — an empty registry means "not
  // installed yet", never "no components", so nothing is filtered against it.
  const { components: registeredComponents } = usePuckConfig();
  const configReady = Object.keys(registeredComponents).length > 0;
  const templateEntries = Object.entries(templates).filter(([key, template]) => {
    if (!configReady || template.component in registeredComponents) return true;
    warnUnknownTemplateComponentOnce(key, template.component, Object.keys(registeredComponents));
    return false;
  });
  const mdxEnabled = Boolean(config.mdxPagesEnabled);
  const configuredLocales = config.locales?.list ?? ['en'];
  const defaultLocale = config.locales?.defaultLocale ?? configuredLocales[0] ?? 'en';

  const [title, setTitle] = useState('');
  const [path, setPath] = useState('');
  // Whether the author typed the path: it is theirs then, and a later title or template change must
  // not replace it. Clearing the field hands the path back to the title.
  const pathTyped = useRef(false);
  const [template, setTemplate] = useState<string>('blank');
  const [locale, setLocale] = useState(defaultLocale);
  // Format: 'puck' (visual editor) or 'mdx' (document page). Default to
  // 'puck' to match prior behavior; the MDX option only renders when
  // at least one site in `sites.json` declares an `mdxPages` path.
  const [format, setFormat] = useState<'puck' | 'mdx'>('puck');
  // Only collected/shown for MDX pages. Optional — leaving it empty is
  // valid; renderers that surface a description use it when present.
  const [description, setDescription] = useState('');

  const [pathnameCheck, setPathnameCheck] = useState<PathnameCheck>('available');
  const [pathnameLoading, setPathnameLoading] = useState(false);
  const [showLoadingText, setShowLoadingText] = useState(false);
  const [pathShapeError, setPathShapeError] = useState<string | null>(null);
  // Bumped by "Try again" to repeat a failed check for the same path.
  const [pathnameRetries, setPathnameRetries] = useState(0);

  // Only a visual page takes a template, so only its path takes the template's prefix.
  const pathPrefix = format === 'puck' ? templates[template]?.pathPrefix : undefined;
  const typedPath = normalizeAndValidatePathname(path);
  const { valid: newPathValid, value: newPathValue, message: newPathMessage } = newPagePath(typedPath, pathPrefix);

  // biome-ignore lint/correctness/useExhaustiveDependencies: A "Try again" click is the event; it repeats the check for the same path.
  useEffect(() => {
    if (!path) {
      setPathnameCheck('available');
      setPathnameLoading(false);
      setShowLoadingText(false);
      setPathShapeError(null);
      return;
    }

    // Run shape validation before hitting the network. If the shape is
    // invalid, surface the error inline and skip the availability check —
    // the backend would reject it anyway with the same reason.
    if (!newPathValid) {
      setPathShapeError(newPathMessage ?? 'Invalid path');
      setPathnameCheck('available');
      setPathnameLoading(false);
      setShowLoadingText(false);
      return;
    }
    setPathShapeError(null);

    // A newer path or locale supersedes this check: its late answer and its
    // loading text must not overwrite the newer check's, whichever comes first.
    let superseded = false;

    // The last answer was for another path or locale: keep Create disabled
    // from now on, not only once the debounced request below goes out.
    setPathnameLoading(true);

    // Add a small debounce to avoid rapid consecutive requests
    const timeoutId = setTimeout(async () => {
      // Show loading text after 500ms delay
      const loadingTextTimeout = setTimeout(() => {
        if (!superseded) setShowLoadingText(true);
      }, 500);

      try {
        // Ask the installed content client, never a hardcoded route: hosts
        // that install their own client do not serve the local API paths.
        const available = await getContentAPIClient().isPathnameAvailable(site, newPathValue, undefined, locale);
        if (!superseded) setPathnameCheck(available ? 'available' : 'taken');
      } catch (error) {
        console.error('Failed to check pathname availability:', error);
        // A failed check says nothing about the path, so it must not let the
        // page be created: the path may already belong to another page.
        if (!superseded) setPathnameCheck('failed');
      } finally {
        clearTimeout(loadingTextTimeout);
        if (!superseded) {
          setPathnameLoading(false);
          setShowLoadingText(false);
        }
      }
    }, 100); // 100ms debounce

    return () => {
      superseded = true;
      clearTimeout(timeoutId);
    };
  }, [path, newPathValid, newPathValue, newPathMessage, site, locale, pathnameRetries]);

  // Auto-generate path from title, including template prefix if applicable,
  // until the author types a path of their own.
  // We read `templates` via getUIConfig() inside the effect so the dep array
  // stays stable — using the component-scope `templates` here would re-run the
  // effect on every render (since `config.templates || {}` creates a fresh
  // empty object each time when no templates are configured), which clobbers
  // manual edits to the path.
  useEffect(() => {
    if (pathTyped.current) return;
    const slug = slugify(title);
    if (!slug) {
      setPath('');
      return;
    }

    const templateConfig = getUIConfig().templates?.[template];
    if (templateConfig?.pathPrefix) {
      const prefix = templateConfig.pathPrefix.endsWith('/')
        ? templateConfig.pathPrefix
        : `${templateConfig.pathPrefix}/`;
      setPath(`${prefix}${slug}`);
    } else {
      setPath(`/${slug}`);
    }
  }, [title, template]);

  // Template change handler - path update handled by useEffect above, until the author types a
  // path: a typed one under the old template's prefix moves to the new one's.
  const handleTemplateChange = (newTemplate: string) => {
    if (pathTyped.current) setPath(movePathPrefix(path, pathPrefix, templates[newTemplate]?.pathPrefix));
    setTemplate(newTemplate);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Submit the path that was checked: tidied (missing leading slash,
    // doubled slashes, trailing slash) and under the template's prefix.
    if (!newPathValid) {
      setPathShapeError(newPathMessage ?? 'Invalid path');
      return;
    }
    onCreatePage?.({
      title,
      path: newPathValue,
      template,
      locale,
      format,
      // Only forward description when MDX is chosen — Puck pages don't
      // use it today and we want the payload to stay clean.
      ...(format === 'mdx' && description ? { description } : {}),
    });
    onOpenChange?.(false);
  };

  const pathError = Boolean(pathShapeError || (pathnameCheck === 'taken' && path));
  // A title such as 'Фото' makes no path, so the field stays empty until the author types one.
  const titleMakesNoPath = title.trim() !== '' && !slugify(title);

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
              <fieldset>
                <legend className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">Format</legend>
                <div className="inline-flex rounded-md border border-grey-09 dark:border-grey-05 overflow-hidden">
                  <label className="cursor-pointer">
                    <input
                      className="peer sr-only"
                      type="radio"
                      name="format"
                      value="puck"
                      checked={format === 'puck'}
                      onChange={() => setFormat('puck')}
                      data-testid="page-format-puck"
                    />
                    <span
                      className={`block px-3 py-1.5 text-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-azure-04 ${
                        format === 'puck'
                          ? 'bg-azure-04 text-white dark:bg-azure-06'
                          : 'bg-transparent text-grey-01 dark:text-grey-12 hover:bg-grey-11 dark:hover:bg-grey-04/40'
                      }`}
                    >
                      Visual page
                    </span>
                  </label>
                  <label className="cursor-pointer">
                    <input
                      className="peer sr-only"
                      type="radio"
                      name="format"
                      value="mdx"
                      checked={format === 'mdx'}
                      onChange={() => setFormat('mdx')}
                      data-testid="page-format-mdx"
                    />
                    <span
                      className={`block px-3 py-1.5 text-sm transition-colors border-l border-grey-09 dark:border-grey-05 peer-focus-visible:ring-2 peer-focus-visible:ring-azure-04 ${
                        format === 'mdx'
                          ? 'bg-azure-04 text-white dark:bg-azure-06'
                          : 'bg-transparent text-grey-01 dark:text-grey-12 hover:bg-grey-11 dark:hover:bg-grey-04/40'
                      }`}
                    >
                      Document page (MDX)
                    </span>
                  </label>
                </div>
                <p className="text-xs text-grey-04 dark:text-grey-07 mt-1">
                  {format === 'puck' ? 'Drag-and-drop blocks on a canvas.' : 'Markdown page rendered by the host site.'}
                </p>
              </fieldset>
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
                  onChange={(e) => {
                    setPath(e.target.value);
                    pathTyped.current = e.target.value !== '';
                  }}
                  error={pathError}
                  required
                  data-testid="page-path-input"
                />
                {pathError && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <AlertCircle className="h-5 w-5 text-red-04 dark:text-red-08" />
                  </div>
                )}
              </div>
              {newPathValid && newPathValue !== typedPath.value && (
                <p className="text-sm text-grey-04 dark:text-grey-07 mt-1">
                  The page will be created at {newPathValue}
                </p>
              )}
              <div className="h-5 mt-1">
                {pathShapeError && <p className="text-sm text-red-04 dark:text-red-08">{pathShapeError}</p>}
                {!pathShapeError && pathnameCheck === 'taken' && path && (
                  <p className="text-sm text-red-04 dark:text-red-08">This pathname is already in use</p>
                )}
                {/* Hidden while a newer check runs: that check will replace the failure. */}
                {!pathShapeError && pathnameCheck === 'failed' && !pathnameLoading && path && (
                  <p className="text-sm text-red-04 dark:text-red-08">
                    Could not check if this path is free.{' '}
                    <button
                      type="button"
                      className="font-medium underline cursor-pointer"
                      onClick={() => setPathnameRetries((retries) => retries + 1)}
                    >
                      Try again
                    </button>
                  </p>
                )}
                {!pathShapeError && pathnameLoading && showLoadingText && path && (
                  <p className="text-sm text-grey-04 dark:text-grey-07">Checking availability...</p>
                )}
                {!path && titleMakesNoPath && (
                  <p className="text-sm text-grey-04 dark:text-grey-07">
                    Type a path: the title has no letters a–z or digits.
                  </p>
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
                disabled={
                  Boolean(pathShapeError) || pathnameCheck !== 'available' || pathnameLoading || !title || !path
                }
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
