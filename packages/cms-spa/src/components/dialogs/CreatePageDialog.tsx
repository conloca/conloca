import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import type { CreatePageData } from '../../types';
import { getUIConfig } from '../../ui-config';

interface CreatePageDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreatePage?: (data: CreatePageData) => void;
  site?: string; // Site identifier for pathname validation
}

export function CreatePageDialog({ open, onOpenChange, onCreatePage, site = 'default' }: CreatePageDialogProps) {
  const [title, setTitle] = useState('');
  const [path, setPath] = useState('');
  const [template, setTemplate] = useState<CreatePageData['template']>('blank');
  const [locale, setLocale] = useState('en');

  // Direct fetch implementation for testing
  const [isPathnameAvailable, setIsPathnameAvailable] = useState(true);
  const [pathnameLoading, setPathnameLoading] = useState(false);
  const [showLoadingText, setShowLoadingText] = useState(false);

  // Use direct fetch instead of React Query to debug the delay
  useEffect(() => {
    if (!path) {
      setIsPathnameAvailable(true);
      setPathnameLoading(false);
      setShowLoadingText(false);
      return;
    }

    // Add a small debounce to avoid rapid consecutive requests
    const timeoutId = setTimeout(async () => {
      console.log('[CreatePageDialog] Starting pathname check for:', path);
      const startTime = performance.now();
      setPathnameLoading(true);

      // Show loading text after 500ms delay
      const loadingTextTimeout = setTimeout(() => {
        setShowLoadingText(true);
      }, 500);

      try {
        const config = getUIConfig();
        const baseUrl = config.apiBaseUrl || '/__cms/api';
        const url = `${baseUrl}/${site}/pathname-available?pathname=${encodeURIComponent(path)}&locale=${locale}`;
        console.log('[CreatePageDialog] Fetching:', url);
        const response = await fetch(url);
        console.log(
          '[CreatePageDialog] Fetch completed in',
          performance.now() - startTime,
          'ms, status:',
          response.status,
        );
        const text = await response.text();
        console.log('[CreatePageDialog] Response text:', text);
        try {
          const data = JSON.parse(text);
          console.log('[CreatePageDialog] Parsed response:', data);
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
        console.log('[CreatePageDialog] Total check time:', performance.now() - startTime, 'ms');
      }
    }, 100); // 100ms debounce

    return () => clearTimeout(timeoutId);
  }, [path, site, locale]);

  // Comment out React Query version for comparison
  // const { data: pathnameData, isLoading: pathnameLoading } = usePathnameAvailability(site, path);
  // const isPathnameAvailable = pathnameData?.available ?? true;

  // Auto-generate path from title
  useEffect(() => {
    const slugified = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    setPath(slugified ? `/${slugified}` : '');
  }, [title]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreatePage?.({
      title,
      path,
      template,
      locale,
    });
    onOpenChange?.(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-lg p-6 w-full max-w-md"
          data-testid="create-page-dialog"
        >
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold">Create New Page</Dialog.Title>
            <Dialog.Close className="p-1 hover:bg-grey-11 rounded">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="title" className="block text-sm font-medium mb-1">
                Title
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                className="w-full px-3 py-2 border border-grey-09 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
                required
                data-testid="page-title-input"
              />
            </div>

            <div>
              <label htmlFor="path" className="block text-sm font-medium mb-1">
                URL Path
              </label>
              <div className="relative">
                <input
                  id="path"
                  type="text"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 ${
                    !isPathnameAvailable && path
                      ? 'border-red-500 focus:ring-red-500'
                      : 'border-grey-09 focus:ring-azure-04'
                  }`}
                  required
                  data-testid="page-path-input"
                />
                {!isPathnameAvailable && path && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <AlertCircle className="h-5 w-5 text-red-500" />
                  </div>
                )}
              </div>
              <div className="h-5 mt-1">
                {!isPathnameAvailable && path && (
                  <p className="text-sm text-red-500">This pathname is already in use</p>
                )}
                {pathnameLoading && showLoadingText && path && (
                  <p className="text-sm text-grey-04">Checking availability...</p>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="template" className="block text-sm font-medium mb-1">
                Template
              </label>
              <select
                id="template"
                value={template}
                onChange={(e) => setTemplate(e.target.value as CreatePageData['template'])}
                className="w-full px-3 py-2 border border-grey-09 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
              >
                <option value="blank">Blank</option>
                <option value="landing">Landing</option>
                <option value="article">Article</option>
              </select>
            </div>

            <div>
              <label htmlFor="locale" className="block text-sm font-medium mb-1">
                Primary Locale
              </label>
              <select
                id="locale"
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                className="w-full px-3 py-2 border border-grey-09 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
              >
                <option value="en">English</option>
                <option value="nl">Dutch</option>
                <option value="fr">French</option>
              </select>
            </div>

            <div className="flex gap-2 pt-4">
              <button
                type="submit"
                disabled={!isPathnameAvailable || pathnameLoading || !title || !path}
                className="flex-1 px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="create-page-submit"
              >
                Create
              </button>
              <Dialog.Close className="flex-1 px-4 py-2 border border-grey-09 rounded hover:bg-grey-11 transition-colors">
                Cancel
              </Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
