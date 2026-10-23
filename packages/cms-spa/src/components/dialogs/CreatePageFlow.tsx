import { APIClientError, useCreateContent } from '@conloca/content-api-client';
import { useNavigate } from 'react-router-dom';
import { useErrorModal } from '../../hooks/index.js';
import type { CreatePageData } from '../../types.js';
import { getUIConfig } from '../../ui-config.js';
import { contentFailureMessage } from '../../utils/content-failure.js';
import { CreatePageDialog } from './CreatePageDialog.js';
import { ErrorModal } from './ErrorModal.js';

interface CreatePageFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: string;
}

const createTemplateContent = (componentName: string) => [
  {
    type: componentName,
    props: {
      id: `${componentName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    },
  },
];

/**
 * The create-page dialog together with what happens after Create: the page is created, its editor opens, and a
 * refusal is shown in an error modal. Shared by the Dashboard and the Pages list, so both New Page buttons
 * behave the same.
 */
export function CreatePageFlow({ open, onOpenChange, site }: CreatePageFlowProps) {
  const { showError, errorModalProps } = useErrorModal();
  const navigate = useNavigate();
  const createContent = useCreateContent();

  const handleCreatePage = async (data: CreatePageData) => {
    try {
      const config = getUIConfig();
      const templateConfig = config.templates?.[data.template];

      // Shared metadata. Description is only added when MDX picked it
      // up — Puck pages don't render it today, so the manifest stays
      // clean for them.
      const meta =
        data.format === 'mdx' && data.description
          ? { title: data.title, description: data.description }
          : { title: data.title };

      // Build a type-specific content payload. MDX pages send an empty
      // body — the editor opens to a blank canvas. Puck pages keep the
      // existing template-driven payload.
      const templateContent =
        data.format !== 'mdx' && templateConfig?.component ? createTemplateContent(templateConfig.component) : [];
      const result = await (data.format === 'mdx'
        ? createContent.mutateAsync({
            kind: 'page',
            site,
            collection: 'pages',
            type: 'mdx',
            meta,
            locales: {
              [data.locale]: {
                meta,
                pathname: data.path,
                // Empty body — backend stamps id/created/modified into
                // frontmatter automatically (see
                // filesystem-content-api.ts createContent, type === 'mdx'
                // branch).
                content: { mdx: '' },
              },
            },
          })
        : createContent.mutateAsync({
            kind: 'page',
            site,
            collection: 'pages',
            type: 'puck',
            meta,
            locales: {
              [data.locale]: {
                meta,
                pathname: data.path,
                content: {
                  puckData: {
                    root: {},
                    content: templateContent,
                    zones: {},
                  },
                },
              },
            },
          }));

      if (result.success && result.id) {
        // Navigate to the new page editor with the actual ID.
        // PageEditorWrapper dispatches by content.type so MDX pages
        // land on MdxPageEditor and Puck pages on the Puck canvas.
        void navigate(`/pages/${result.id}`);
      } else {
        // The dialog has already closed, so this is the author's only answer:
        // say why (a path taken since the check), not just "try again".
        showError(contentFailureMessage(result, 'Failed to create page. Please try again.'), result.error);
      }
    } catch (error) {
      console.error('Failed to create page:', error);
      // The content-API router answers a refusal, such as a path another page took since the check,
      // with an error status, which the client throws: say why, as for a refusal the result carries.
      showError(error instanceof APIClientError ? error.message : 'Failed to create page. Please try again.', error);
    }
  };

  return (
    <>
      <CreatePageDialog open={open} onOpenChange={onOpenChange} onCreatePage={handleCreatePage} site={site} />
      <ErrorModal {...errorModalProps} />
    </>
  );
}
