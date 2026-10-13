import { APIClientError, ErrorCodes, getContentAPIClient, useCreateContent } from '@conloca/content-api-client';
import { useEffect, useState } from 'react';
import { getUIConfig } from '../../ui-config.js';
import { contentFailureMessage } from '../../utils/content-failure.js';
import { untitledName, untitledNameNote } from '../../utils/entry-name.js';
import { slugify } from '../../utils/slugify.js';
import { Button, Input } from '../ui/index.js';

// Friendly inline copy for the typed failures the server can return when
// creating a fragment. The dialog renders the result under the title field and
// stays open so the user can rename and retry. Returns undefined for codes
// we don't have a tailored message for, letting the caller fall back to the
// raw error.message. `nameTaken` is the copy for a name another fragment has.
function mapCreateErrorCode(code: string | undefined, nameTaken: string): string | undefined {
  switch (code) {
    case ErrorCodes.NAME_TAKEN:
    case ErrorCodes.ALREADY_EXISTS:
      return nameTaken;
    case ErrorCodes.PATHNAME_TAKEN:
      return 'A page with that pathname already exists. Please choose a different title.';
    case ErrorCodes.INVALID_REQUEST:
      return 'The fragment name is invalid. Use letters, numbers, or hyphens.';
    case ErrorCodes.METADATA_TOO_LARGE:
      return 'The metadata is too large. Please shorten the title or description.';
    default:
      return undefined;
  }
}

// Same mapping, keyed by the structural `reason` field from CreateResult.
// Defensive — the API currently always returns non-2xx for failures, so we
// usually go through the APIClientError path above.
function mapCreateErrorReason(reason: string | undefined, nameTaken: string): string | undefined {
  switch (reason) {
    case 'name_taken':
    case 'already_exists':
      return nameTaken;
    case 'pathname_taken':
      return 'A page with that pathname already exists. Please choose a different title.';
    case 'invalid_name':
      return 'The fragment name is invalid. Use letters, numbers, or hyphens.';
    case 'metadata_too_large':
      return 'The metadata is too large. Please shorten the title or description.';
    default:
      return undefined;
  }
}

/**
 * Why the new fragment cannot have `name`: another fragment has the name its title makes or, when
 * the title makes none, took the untitled name made for it since the dialog read the names.
 */
function nameTakenCopy(name: string, fromTitle: boolean): string {
  return fromTitle
    ? 'A fragment with this name already exists. Please choose a different title.'
    : `${untitledNameNote(name)} Another fragment took that name just now. Please try again.`;
}

interface CreateFragmentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Called with the new fragment's id (and etag, if returned) after the server
   * confirms creation. Consumers typically navigate to `/fragments/:id` or wire
   * the id back into a parent field (Puck `onChange`).
   */
  onCreated: (result: { id: string; etag?: string }) => void;
}

/**
 * Metadata-first "new fragment" dialog. Asks for a title, then creates the
 * entity server-side with a one-line MDX scaffold (`# <title>` plus a
 * blank-line prompt) and hands the new id back to the parent.
 *
 * Replaces the old "metadata dialog → fullscreen MDX modal" two-step. The
 * page-route editor (`/fragments/:id`) takes over after creation, giving the
 * user the full unsaved-changes guard, conflict recovery, and locale
 * switching that the modal lacked.
 */
export function CreateFragmentDialog({ isOpen, onClose, onCreated }: CreateFragmentDialogProps) {
  const createContent = useCreateContent();
  const localeConfig = getUIConfig().locales;
  const defaultLocale = localeConfig?.defaultLocale ?? localeConfig?.list[0] ?? 'en';
  const [titleInput, setTitleInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  // From the Create click until the create answers, including while a title with no a–z or 0–9
  // waits for the fragment names: a second click then would create a second fragment.
  const [submitting, setSubmitting] = useState(false);

  // Reset transient state every time the dialog re-opens so a previously
  // dismissed error / typed title doesn't leak into a fresh create flow.
  useEffect(() => {
    if (isOpen) {
      setTitleInput('');
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const isPending = submitting;
  const canSubmit = !!titleInput.trim() && !isPending;

  const handleSubmit = async () => {
    const title = titleInput.trim();
    if (!title) {
      setError('Enter a fragment title before continuing.');
      return;
    }

    setError(null);
    const initialContent = `# ${title}\n\nWrite your content here.\n`;
    const collection = 'fragments';
    const slug = slugify(title);
    let name = slug;

    setSubmitting(true);
    try {
      // A title with no a–z or 0–9 (Фото, 照片) makes no name: take an untitled one no fragment has.
      name ||= untitledName((await getContentAPIClient().getFragments(collection)).items);
      const result = await createContent.mutateAsync({
        kind: 'fragment',
        collection,
        type: 'mdx',
        name,
        meta: { title },
        locales: {
          [defaultLocale]: {
            meta: { title },
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
      setError(
        mapCreateErrorReason(result.reason, nameTakenCopy(name, !!slug)) ||
          contentFailureMessage(result, 'Failed to create fragment.'),
      );
    } catch (err) {
      // The server-side createContent surfaces typed failures as non-2xx
      // responses (409 name_taken, 400 invalid_name, etc.) which the API
      // client converts into APIClientError with an `error.code`. Map
      // those codes onto friendly inline copy. Unknown errors fall back
      // to the raw message.
      if (err instanceof APIClientError) {
        setError(
          mapCreateErrorCode(err.code, nameTakenCopy(name, !!slug)) || err.message || 'Failed to create fragment.',
        );
        return;
      }
      console.error('Failed to create fragment:', err);
      setError(err instanceof Error ? err.message : 'Failed to create fragment. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-fragment-dialog-title"
    >
      <div className="bg-overlay rounded-lg p-6 w-full max-w-md" data-testid="create-fragment-dialog">
        <h2 id="create-fragment-dialog-title" className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-4">
          Create New Fragment
        </h2>
        <div className="mb-4">
          <label htmlFor="fragment-title" className="block text-sm font-medium mb-2 text-grey-01 dark:text-grey-12">
            Fragment Title
          </label>
          <Input
            id="fragment-title"
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
            placeholder="Enter fragment title..."
            autoFocus
            error={!!error}
            data-testid="fragment-title-input"
            disabled={isPending}
          />
          <p className="mt-2 text-sm text-grey-04 dark:text-grey-07">
            This will be used as the display name for your fragment
          </p>
        </div>
        {error ? (
          <p className="mb-4 text-sm text-red-04 dark:text-red-08" role="alert" data-testid="create-fragment-error">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit} data-testid="create-fragment-submit">
            {isPending ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}
