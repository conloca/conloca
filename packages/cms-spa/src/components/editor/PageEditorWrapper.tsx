import { useBlocks, useDataContext, useLocalizedContent, useUpdateLocalized } from '@conloca/content-api-client';
import type { ComponentConfig, Config, Data } from '@puckeditor/core';
import { resolveAllData } from '@puckeditor/core';
import cn from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { PageMetadata } from '../../types';
import { PageMetadataDialog } from '../dialogs/PageMetadataDialog';
import { type ContentBlockOption, ContentBlockSelectorField } from '../fields/ContentBlockSelectorField';
import { BlockContentWrapper, BlockFieldWrapper } from './BlockWrappers';
import { PageEditor } from './PageEditor';

/**
 * Merge component defaultProps with stored sparse props.
 *
 * Puck saves sparse data - only props the user explicitly changed.
 * When loading, we need to merge defaultProps so field UI shows correct values.
 * Without this, select/radio fields show wrong defaults (first option instead of actual default).
 *
 * Note: This merge is intentionally shallow (`{ ...defaultProps, ...item.props }`).
 * New top-level fields added to a component get their default value automatically.
 * However, new fields added inside array item types (e.g., adding `linkTarget` to
 * FeatureCard) won't be backfilled into existing saved items — component renders
 * must handle `undefined` for any array item field that may not exist in older content.
 */
function mergeDefaultProps(data: Data, config: Config): Data {
  if (!data?.content || !config?.components) return data;

  const mergeComponentProps = (item: Data['content'][0]): Data['content'][0] => {
    const componentConfig = config.components[item.type];
    if (!componentConfig?.defaultProps) return item;

    return {
      ...item,
      props: {
        ...componentConfig.defaultProps,
        ...item.props,
      },
    };
  };

  const mergedContent = data.content.map(mergeComponentProps);

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

interface ContentBlockSectionProps {
  label?: string;
  blockId: string;
  width?: 'narrow' | 'default';
  tone?: 'transparent' | 'subtle';
  startsNewSection?: boolean | 'true' | 'false';
}

const contentBlockWidthClasses: Record<NonNullable<ContentBlockSectionProps['width']>, string> = {
  narrow: 'max-w-3xl',
  default: 'max-w-4xl',
};

const contentBlockToneClasses: Record<NonNullable<ContentBlockSectionProps['tone']>, string> = {
  transparent: '',
  subtle:
    'rounded-3xl border border-surface-200/80 bg-surface-100/70 p-6 sm:p-8 dark:border-surface-800/60 dark:bg-surface-900/50',
};

/**
 * Wrapper component for PageEditor that loads and pre-resolves data.
 *
 * Key insight: Puck's internal resolveData only runs on mount and doesn't
 * react to metadata prop changes. To ensure data-bound components (like
 * BlogPostGrid) receive their data, we must pre-resolve using resolveAllData()
 * BEFORE passing data to Puck. This matches the production renderer behavior
 * in page-handler.astro.
 */
export function PageEditorWrapper({ puckConfig }: PageEditorWrapperProps) {
  const { id } = useParams();
  const navigate = useNavigate();
  const updateContent = useUpdateLocalized();

  // Load page content
  const { data: content, isLoading: isLoadingContent, error } = useLocalizedContent(id || '', 'en');

  // Load user-created blocks for config enhancement
  const { data: blocksData } = useBlocks();

  // Load DataContext for data-bound components (e.g. BlogPostGrid)
  const { data: dataContextResponse, isLoading: isLoadingDataContext } = useDataContext(id);

  // Store current ETag for optimistic locking
  const [currentEtag, setCurrentEtag] = useState<string>('');

  // Metadata dialog state
  const [metadataDialogOpen, setMetadataDialogOpen] = useState(false);

  // Pre-resolved Puck data (resolved BEFORE passing to Puck)
  const [resolvedPuckData, setResolvedPuckData] = useState<Data | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  useEffect(() => {
    if (content?.localized?.etag) {
      setCurrentEtag(content.localized.etag);
    }
  }, [content]);

  // Enhance Puck config with user-created blocks
  const enhancedConfig = useMemo(() => {
    if (!puckConfig || !blocksData?.items) return puckConfig;

    const blockOptions: ContentBlockOption[] = blocksData.items.map((block) => {
      const locales = Object.keys(block.locales);
      const firstLocale = locales.length > 0 ? block.locales[locales[0]] : null;
      const label = firstLocale?.meta?.title || firstLocale?.name || block.id;

      return {
        value: block.id,
        label,
        description: firstLocale?.meta?.description,
        category: firstLocale?.meta?.category,
      };
    });

    const blockComponents: Record<string, ComponentConfig<{ contentId: string }>> = {};
    const blockCategoryList: string[] = [];

    blocksData.items.forEach((block) => {
      const componentKey = `Block_${block.id}`;
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

    const existingCategories = puckConfig.categories || {};
    const existingComponents = puckConfig.components || {};
    const contentBlockSection = existingComponents.ContentBlockSection as
      | ComponentConfig<ContentBlockSectionProps>
      | undefined;

    const enhancedContentBlockSection = contentBlockSection
      ? {
          ...contentBlockSection,
          fields: {
            ...contentBlockSection.fields,
            blockId: {
              type: 'custom',
              label: 'Content Block',
              render: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
                <ContentBlockSelectorField value={value} onChange={onChange} options={blockOptions} />
              ),
            },
          },
          render: ({
            blockId,
            label,
            title,
            subtitle,
            tone = 'transparent',
            width = 'default',
            startsNewSection,
          }: ContentBlockSectionProps & {
            title?: string;
            subtitle?: string;
            startsNewSection?: boolean | 'true' | 'false';
          }) => (
            <section className="pb-16 sm:pb-20">
              <div className={cn('mx-auto px-4 sm:px-6 lg:px-8', contentBlockWidthClasses[width])}>
                {label ? (
                  <p className="mb-4 text-sm font-medium uppercase tracking-[0.18em] text-brand-700 dark:text-brand-300">
                    {label}
                  </p>
                ) : null}
                {title ? (
                  <h2 className="text-2xl sm:text-3xl font-bold text-surface-900 dark:text-white mb-4">{title}</h2>
                ) : null}
                {subtitle ? (
                  <p className="text-surface-500 dark:text-surface-400 text-sm leading-relaxed mb-6">{subtitle}</p>
                ) : null}
                <div className={cn(contentBlockToneClasses[tone])}>
                  {blockId ? (
                    <BlockContentWrapper contentId={blockId} />
                  ) : (
                    <div className="rounded border border-dashed border-surface-300 dark:border-surface-700 px-5 py-6 text-sm text-surface-500 dark:text-surface-400">
                      Select an MDX content block to render here.
                    </div>
                  )}
                </div>
              </div>
            </section>
          ),
        }
      : undefined;

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
        ...(enhancedContentBlockSection && { ContentBlockSection: enhancedContentBlockSection }),
        ...blockComponents,
      } as Record<string, ComponentConfig<any>>,
    } as Config;
  }, [puckConfig, blocksData]);

  // Pre-resolve component data using resolveAllData.
  // This runs each component's resolveData with the dataContext metadata,
  // ensuring data-bound components have their data BEFORE Puck mounts.
  useEffect(() => {
    let cancelled = false;
    const puckData = content?.localized?.content?.puckData;

    if (!puckData || !enhancedConfig) {
      setResolvedPuckData(null);
      return;
    }

    const dataContext = dataContextResponse?.dataContext;
    const mergedData = mergeDefaultProps(puckData, enhancedConfig);

    // If no dataContext, use merged data as-is
    if (!dataContext) {
      setResolvedPuckData(mergedData);
      return;
    }

    // Resolve with dataContext
    setIsResolving(true);
    resolveAllData(mergedData, enhancedConfig, { metadata: dataContext })
      .then((resolved) => {
        if (!cancelled) {
          setResolvedPuckData(resolved);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[PageEditorWrapper] resolveAllData failed:', err);
          setResolvedPuckData(mergedData);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsResolving(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [content?.localized?.content?.puckData, enhancedConfig, dataContextResponse]);

  // Show loading while fetching or resolving
  if (isLoadingContent || isLoadingDataContext || isResolving || !resolvedPuckData) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  if (error || !content || !content.localized) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-red-500">Failed to load page: {error?.message || 'Not found'}</div>
      </div>
    );
  }

  // Build entry with resolved puckData
  const entryWithResolvedData = {
    ...content,
    localized: {
      ...content.localized,
      content: {
        ...content.localized.content,
        puckData: resolvedPuckData,
      },
    },
  };

  return (
    <>
      <PageEditor
        pageId={content.id}
        entry={entryWithResolvedData}
        config={enhancedConfig}
        // Pass dataContext for Puck's internal resolveData (field changes, etc.)
        metadata={dataContextResponse?.dataContext ? { metadata: dataContextResponse.dataContext } : undefined}
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
              setCurrentEtag(result.etag);
            }

            return result;
          } catch (error) {
            console.error('Failed to save page:', error);
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
          window.location.reload();
        }}
      />

      <PageMetadataDialog
        open={metadataDialogOpen}
        onOpenChange={setMetadataDialogOpen}
        page={(() => {
          // Extract custom metadata: everything in meta except core SEO fields
          const coreMetaKeys = new Set([
            'title',
            'description',
            'robots',
            'canonical',
            'keywords',
            'ogTitle',
            'ogDescription',
            'ogImage',
          ]);
          const customMeta: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(content.localized.meta)) {
            if (!coreMetaKeys.has(key)) {
              customMeta[key] = value;
            }
          }
          return {
            title: content.localized.meta.title || '',
            description: content.localized.meta.description || '',
            pathname: content.localized.pathname || '/',
            publishDate: content.localized.publishAt ? new Date(content.localized.publishAt) : null,
            unpublishDate: content.localized.unpublishAt ? new Date(content.localized.unpublishAt) : null,
            robots: content.localized.meta.robots,
            canonical: content.localized.meta.canonical,
            customMeta,
          };
        })()}
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
                  ...(metadata.customMeta || {}),
                },
                pathname: metadata.pathname,
                publishAt: metadata.publishDate?.toISOString() || null,
                unpublishAt: metadata.unpublishDate?.toISOString() || null,
              },
              etag: currentEtag,
            });

            if (result.success && result.etag) {
              setCurrentEtag(result.etag);
            }
          } catch (error) {
            console.error('Failed to save metadata:', error);
          }
        }}
      />
    </>
  );
}
