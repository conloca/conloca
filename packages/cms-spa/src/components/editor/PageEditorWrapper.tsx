import { useBlocks, useLocalizedContent, useUpdateLocalized } from '@conloca/content-api-client';
import type { ComponentConfig, Config, Data } from '@measured/puck';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { PageMetadata } from '../../types';
import { getUIConfig } from '../../ui-config';
import { PageMetadataDialog } from '../dialogs/PageMetadataDialog';
import { BlockContentWrapper, BlockFieldWrapper } from './BlockWrappers';
import { PageEditor } from './PageEditor';

/**
 * Merge component defaultProps with stored sparse props.
 *
 * Puck saves sparse data - only props the user explicitly changed.
 * When loading, we need to merge defaultProps so field UI shows correct values.
 * Without this, select/radio fields show wrong defaults (first option instead of actual default).
 */
function mergeDefaultProps(data: Data, config: Config): Data {
  if (!data?.content || !config?.components) return data;

  // Helper to merge props for a single component
  const mergeComponentProps = (item: Data['content'][0]): Data['content'][0] => {
    const componentConfig = config.components[item.type];
    if (!componentConfig?.defaultProps) return item;

    // Merge defaultProps with stored props (stored props take precedence)
    return {
      ...item,
      props: {
        ...componentConfig.defaultProps,
        ...item.props,
      },
    };
  };

  // Merge top-level content
  const mergedContent = data.content.map(mergeComponentProps);

  // Also merge zones if they exist (nested components)
  let mergedZones = data.zones;
  if (data.zones) {
    mergedZones = {};
    for (const [zoneKey, zoneContent] of Object.entries(data.zones)) {
      mergedZones[zoneKey] = zoneContent.map(mergeComponentProps);
    }
  }

  return {
    ...data,
    content: mergedContent,
    ...(mergedZones && { zones: mergedZones }),
  };
}

interface PageEditorWrapperProps {
  puckConfig: Config;
}

/**
 * Wrapper component for PageEditor that loads data
 */
export function PageEditorWrapper({ puckConfig }: PageEditorWrapperProps) {
  const { id } = useParams();
  const navigate = useNavigate();
  const updateContent = useUpdateLocalized();

  // Load content with the ID
  const { data: content, isLoading, error } = useLocalizedContent(id || '', 'en');

  // Fetch blocks to add to Puck config
  const { data: blocksData } = useBlocks();

  // Fetch DataContext for data-bound components (e.g. BlogPostGrid)
  // Silent fallback: if fetch fails, components show empty state as before
  const apiBaseUrl = getUIConfig().apiBaseUrl || '/__cms/api';
  const { data: dataContextResponse } = useQuery({
    queryKey: ['data-context', id],
    queryFn: () =>
      fetch(`${apiBaseUrl}/data-context?pageId=${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Store the current ETag for saving
  const [currentEtag, setCurrentEtag] = useState<string>('');

  // Metadata dialog state
  const [metadataDialogOpen, setMetadataDialogOpen] = useState(false);

  useEffect(() => {
    if (content?.localized?.etag) {
      setCurrentEtag(content.localized.etag);
    }
  }, [content]);

  // Enhance Puck config with user-created blocks
  const enhancedConfig = useMemo(() => {
    if (!puckConfig || !blocksData?.items) return puckConfig;

    const blockComponents: Record<string, ComponentConfig<{ contentId: string }>> = {};
    const blockCategoryList: string[] = [];

    // Create a component config for each block
    blocksData.items.forEach((block) => {
      const componentKey = `Block_${block.id}`;

      // Get block title from first available locale
      const locales = Object.keys(block.locales);
      const firstLocale = locales.length > 0 ? block.locales[locales[0]] : null;
      const blockTitle = firstLocale?.meta?.title || firstLocale?.name || block.id;

      blockComponents[componentKey] = {
        label: blockTitle,
        fields: {
          contentId: {
            type: 'custom',
            label: 'Content Block',
            render: ({ value }: { value: string }) => <BlockFieldWrapper contentId={value} />,
          },
        },
        defaultProps: { contentId: block.id },
        render: ({ contentId }: { contentId: string }) => <BlockContentWrapper contentId={contentId} />,
      };
      blockCategoryList.push(componentKey);
    });

    // Merge with existing config
    const existingCategories = puckConfig.categories || {};
    const existingComponents = puckConfig.components || {};

    // Create enhanced config with proper typing
    // Note: 'as Record<string, ComponentConfig<any>>' is necessary because Puck's Config
    // type expects a statically defined component map, but we're dynamically adding
    // user-created blocks at runtime. The 'any' for component props is acceptable here
    // since each block component has its own proper type definition above.
    return {
      ...puckConfig,
      categories: {
        ...existingCategories,
        blocks: {
          title: 'Blocks',
          components: blockCategoryList,
        },
      },
      components: {
        ...existingComponents,
        ...blockComponents,
      } as Record<string, ComponentConfig<any>>,
    } as Config;
  }, [puckConfig, blocksData]);

  // Create entry with merged defaultProps for proper field UI display
  // This ensures select/radio fields show correct defaults, not first option
  const entryWithMergedDefaults = useMemo(() => {
    if (!content?.localized?.content?.puckData || !enhancedConfig) return content;

    const mergedPuckData = mergeDefaultProps(content.localized.content.puckData, enhancedConfig);

    return {
      ...content,
      localized: {
        ...content.localized,
        content: {
          ...content.localized.content,
          puckData: mergedPuckData,
        },
      },
    };
  }, [content, enhancedConfig]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  if (error || !content || !content.localized) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-red-500">Failed to load page: {error?.message || 'Not found'}</div>
      </div>
    );
  }

  return (
    <>
      <PageEditor
        pageId={content.id}
        entry={entryWithMergedDefaults!}
        config={enhancedConfig}
        metadata={dataContextResponse?.dataContext ?? undefined}
        availableLocales={['en']}
        onSave={async (newData, forceEtag) => {
          try {
            const result = await updateContent.mutateAsync({
              id: content.id,
              locale: 'en',
              data: {
                content: { puckData: newData },
              },
              etag: forceEtag || currentEtag,
            });

            if (result.success && result.etag) {
              console.log('Page saved successfully');
              setCurrentEtag(result.etag); // Update ETag for next save
            }

            return result;
          } catch (error) {
            console.error('Failed to save page:', error);
            // Return a failed result for error handling
            return {
              success: false,
              reason: 'write_error' as const,
              error: error as Error,
            };
          }
        }}
        onBack={() => navigate('/pages')}
        onOpenMetadata={() => {
          setMetadataDialogOpen(true);
        }}
        onReload={() => {
          // Reload the page to get fresh data
          window.location.reload();
        }}
      />

      {/* Metadata Dialog */}
      <PageMetadataDialog
        open={metadataDialogOpen}
        onOpenChange={setMetadataDialogOpen}
        page={{
          title: content.localized.meta.title || '',
          description: content.localized.meta.description || '',
          pathname: content.localized.pathname || '/',
          publishDate: content.localized.publishAt ? new Date(content.localized.publishAt) : null,
          unpublishDate: content.localized.unpublishAt ? new Date(content.localized.unpublishAt) : null,
          robots: content.localized.meta.robots,
          canonical: content.localized.meta.canonical,
        }}
        onSave={async (metadata: PageMetadata) => {
          try {
            const result = await updateContent.mutateAsync({
              id: content.id,
              locale: 'en',
              data: {
                meta: {
                  title: metadata.title,
                  description: metadata.description,
                  robots: metadata.robots,
                  canonical: metadata.canonical,
                },
                pathname: metadata.pathname,
                publishAt: metadata.publishDate?.toISOString() || null,
                unpublishAt: metadata.unpublishDate?.toISOString() || null,
              },
              etag: currentEtag,
            });

            if (result.success && result.etag) {
              console.log('Metadata saved successfully');
              setCurrentEtag(result.etag); // Update ETag for next save
            }
          } catch (error) {
            console.error('Failed to save metadata:', error);
          }
        }}
      />
    </>
  );
}
