import { APIClientError, ErrorCodes, useCreateContent } from '@conloca/content-api-client';
import { useEffect, useState } from 'react';
import { slugify } from '../../utils/slugify';
import { Button, Input, Select } from '../ui';
import { contentBlockTemplates, getContentBlockTemplate, renderContentBlockTemplate } from './content-block-templates';

// Friendly inline copy for the typed failures the server can return when
// creating a block. The dialog renders the result under the title field and
// stays open so the user can rename and retry. Returns undefined for codes
// we don't have a tailored message for, letting the caller fall back to the
// raw error.message.
function mapCreateErrorCode(code: string | undefined): string | undefined {
  switch (code) {
    case ErrorCodes.NAME_TAKEN:
    case ErrorCodes.ALREADY_EXISTS:
      return 'A block with this name already exists. Please choose a different title.';
    case ErrorCodes.PATHNAME_TAKEN:
      return 'A page with that pathname already exists. Please choose a different title.';
    case ErrorCodes.INVALID_REQUEST:
      return 'The block name is invalid. Use letters, numbers, or hyphens.';
    case ErrorCodes.METADATA_TOO_LARGE:
      return 'The metadata is too large. Please shorten the title or description.';
    default:
      return undefined;
  }
}

// Same mapping, keyed by the structural `reason` field from CreateResult.
// Defensive — the API currently always returns non-2xx for failures, so we
// usually go through the APIClientError path above.
function mapCreateErrorReason(reason: string | undefined): string | undefined {
  switch (reason) {
    case 'name_taken':
    case 'already_exists':
      return 'A block with this name already exists. Please choose a different title.';
    case 'pathname_taken':
      return 'A page with that pathname already exists. Please choose a different title.';
    case 'invalid_name':
      return 'The block name is invalid. Use letters, numbers, or hyphens.';
    case 'metadata_too_large':
      return 'The metadata is too large. Please shorten the title or description.';
    default:
      return undefined;
  }
}

interface CreateBlockDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Called with the new block's id (and etag, if returned) after the server
   * confirms creation. Consumers typically navigate to `/blocks/:id` or wire
   * the id back into a parent field (Puck `onChange`).
   */
  onCreated: (result: { id: string; etag?: string }) => void;
  /**
   * Optional initial template id. Defaults to the first registered template.
   * Useful when a parent UI wants to pre-pick a template variant.
   */
  initialTemplateId?: string;
}

/**
 * Metadata-first "new block" dialog. Asks for a title + starter template,
 * then creates the entity server-side with the rendered template MDX as the
 * initial content and hands the new id back to the parent.
 *
 * Replaces the old "metadata dialog → fullscreen MDX modal" two-step. The
 * page-route editor (`/blocks/:id`) takes over after creation, giving the
 * user the full unsaved-changes guard, conflict recovery, and locale
 * switching that the modal lacked.
 */
export function CreateBlockDialog({ isOpen, onClose, onCreated, initialTemplateId }: CreateBlockDialogProps) {
  const createContent = useCreateContent();
  const [titleInput, setTitleInput] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialTemplateId || contentBlockTemplates[0]?.id || '');
  const [error, setError] = useState<string | null>(null);

  // Reset transient state every time the dialog re-opens so a previously
  // dismissed error / typed title doesn't leak into a fresh create flow.
  useEffect(() => {
    if (isOpen) {
      setTitleInput('');
      setSelectedTemplateId(initialTemplateId || contentBlockTemplates[0]?.id || '');
      setError(null);
    }
  }, [isOpen, initialTemplateId]);

  if (!isOpen) {
    return null;
  }

  const isPending = createContent.isPending;
  const canSubmit = !!titleInput.trim() && !isPending;

  const handleSubmit = async () => {
    const title = titleInput.trim();
    if (!title) {
      setError('Enter a block title before continuing.');
      return;
    }

    setError(null);
    const template = getContentBlockTemplate(selectedTemplateId);
    const initialContent = renderContentBlockTemplate(selectedTemplateId, title);

    try {
      const result = await createContent.mutateAsync({
        kind: 'block',
        collection: 'blocks',
        type: 'mdx',
        name: slugify(title) || 'untitled',
        meta: {
          title,
          category: template?.category,
        },
        locales: {
          en: {
            meta: {
              title,
              category: template?.category,
            },
            content: {
              mdx: initialContent,
            },
          },
        },
      });

      if (result.success && result.id) {
        onCreated({ id: result.id, etag: result.etag });
        return;
      }

      // Defensive: if the API ever decides to return success: false in a
      // 2xx body (it currently does not), fall back to result.reason.
      setError(mapCreateErrorReason(result.reason) || result.error?.message || 'Failed to create block.');
    } catch (err) {
      // The server-side createContent surfaces typed failures as non-2xx
      // responses (409 name_taken, 400 invalid_name, etc.) which the API
      // client converts into APIClientError with an `error.code`. Map
      // those codes onto friendly inline copy. Unknown errors fall back
      // to the raw message.
      if (err instanceof APIClientError) {
        setError(mapCreateErrorCode(err.code) || err.message || 'Failed to create block.');
        return;
      }
      console.error('Failed to create block:', err);
      setError(err instanceof Error ? err.message : 'Failed to create block. Please try again.');
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-block-dialog-title"
    >
      <div className="bg-overlay rounded-lg p-6 w-full max-w-md" data-testid="create-block-dialog">
        <h2 id="create-block-dialog-title" className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-4">
          Create New Block
        </h2>
        <div className="mb-4">
          <label htmlFor="block-title" className="block text-sm font-medium mb-2 text-grey-01 dark:text-grey-12">
            Block Title
          </label>
          <Input
            id="block-title"
            type="text"
            value={titleInput}
            onChange={(e) => {
              setTitleInput(e.target.value);
              // Clear stale error as soon as the user edits the field —
              // otherwise the "name taken" message lingers even after the
              // user has typed a different title.
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (canSubmit) void handleSubmit();
              }
            }}
            placeholder="Enter block title..."
            autoFocus
            error={!!error}
            data-testid="block-title-input"
            disabled={isPending}
          />
          <p className="mt-2 text-sm text-grey-04 dark:text-grey-07">
            This will be used as the display name for your block
          </p>
        </div>
        <div className="mb-4">
          <label htmlFor="block-template" className="block text-sm font-medium mb-2 text-grey-01 dark:text-grey-12">
            Starter Template
          </label>
          <Select
            id="block-template"
            value={selectedTemplateId}
            onChange={(e) => setSelectedTemplateId(e.target.value)}
            disabled={isPending}
          >
            {contentBlockTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.label}
              </option>
            ))}
          </Select>
          <p className="mt-2 text-sm text-grey-04 dark:text-grey-07">
            {getContentBlockTemplate(selectedTemplateId)?.description}
          </p>
        </div>
        {error ? (
          <p className="mb-4 text-sm text-red-04" role="alert" data-testid="create-block-error">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit} data-testid="create-block-submit">
            {isPending ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}
