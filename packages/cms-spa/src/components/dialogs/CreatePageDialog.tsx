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

export function CreatePageDialog({ open, onOpenChange, onCreatePage, site = 'default' }: CreatePageDialogProps) {
  const [title, setTitle] = useState('');
  const [path, setPath] = useState('');
  const [template, setTemplate] = useState<string>('blank');
  const [locale, setLocale] = useState('en');

  // Get templates from config
  const config = getUIConfig();
  const templates = config.templates || {};
  const templateEntries = Object.entries(templates);

  const [isPathnameAvailable, setIsPathnameAvailable] = useState(true);
  const [pathnameLoading, setPathnameLoading] = useState(false);
  const [showLoadingText, setShowLoadingText] = useState(false);

  useEffect(() => {
    if (!path) {
      setIsPathnameAvailable(true);
      setPathnameLoading(false);
      setShowLoadingText(false);
      return;
    }

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
        const url = `${baseUrl}/${site}/pathname-available?pathname=${encodeURIComponent(path)}&locale=${locale}`;
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

  // Auto-generate path from title, including template prefix if applicable
  useEffect(() => {
    const slug = slugify(title);
    if (!slug) {
      setPath('');
      return;
    }

    // Check if current template has a pathPrefix
    const templateConfig = templates[template];
    if (templateConfig?.pathPrefix) {
      const prefix = templateConfig.pathPrefix.endsWith('/')
        ? templateConfig.pathPrefix
        : `${templateConfig.pathPrefix}/`;
      setPath(`${prefix}${slug}`);
    } else {
      setPath(`/${slug}`);
    }
  }, [title, template, templates]);

  // Template change handler - path update handled by useEffect above
  const handleTemplateChange = (newTemplate: string) => {
    setTemplate(newTemplate);
  };

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

  const pathError = Boolean(!isPathnameAvailable && path);

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
                {pathError && <p className="text-sm text-red-04">This pathname is already in use</p>}
                {pathnameLoading && showLoadingText && path && (
                  <p className="text-sm text-grey-04 dark:text-grey-07">Checking availability...</p>
                )}
              </div>
            </div>

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

            <div>
              <label htmlFor="locale" className="block text-sm font-medium mb-1 text-grey-01 dark:text-grey-12">
                Primary Locale
              </label>
              <Select id="locale" value={locale} onChange={(e) => setLocale(e.target.value)}>
                <option value="en">English</option>
                <option value="nl">Dutch</option>
                <option value="fr">French</option>
              </Select>
            </div>

            <div className="flex gap-2 pt-4">
              <Button
                type="submit"
                variant="primary"
                disabled={!isPathnameAvailable || pathnameLoading || !title || !path}
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
