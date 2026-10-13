import {
  type ContentManifest,
  type MDXHeading,
  metaString,
  pageReferenceOf,
  StaleWriteError,
  useCompileMDX,
  useContent,
  useDataContext,
  useFragments,
  useLocalizedContent,
  useSitesConfig,
  useUpdateLocalized,
} from '@conloca/content-api-client';
import type { ComponentConfig, Config, Data, PuckComponent } from '@puckeditor/core';
import { resolveAllData } from '@puckeditor/core';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { mergeDefaultProps } from '../../merge-default-props.js';
import type { PageMetadata } from '../../types.js';
import { getUIConfig } from '../../ui-config.js';
import { contentFailureMessage } from '../../utils/content-failure.js';
import { buildMetadataUpdate, extractPageMetadata } from '../../utils/pageMetadata.js';
import { PageMetadataDialog } from '../dialogs/PageMetadataDialog.js';
import { type ContentFragmentOption, ContentFragmentSelectorField } from '../fields/ContentFragmentSelectorField.js';
import { FragmentContentWrapper, FragmentFieldWrapper } from './FragmentWrappers.js';
import { MdxPageEditor } from './MdxPageEditor.js';
import { PageEditor } from './PageEditor.js';

interface PageEditorWrapperProps {
  puckConfig: Config;
}

/**
 * Props a host's `ContentFragmentSection` block receives. The platform resolves
 * the block's `fragmentId` and hands the evaluated fragment back as `fragment`,
 * so the site owns every element around it; `fragment` is undefined when the id
 * resolves to nothing. `@conloca/astro-cms` re-exports this for host sites.
 */
export interface ContentFragmentSectionProps {
  fragmentId: string;
  fragment?: ReactNode;
  /**
   * The fragment's headings, in document order, carrying the ids its markup
   * puts on them. Supplied by the platform on both surfaces so a site can show
   * a contents list without reading the rendered page back — which the editor
   * cannot do anyway, since the body renders in a sandbox it cannot see into.
   */
  fragmentOutline?: readonly MDXHeading[];
}

/**
 * The selected fragment's headings, for a host block that shows a contents
 * list. The body renders in a sandbox this document cannot read, so the
 * outline comes off the compile instead — the same compile the preview
 * already requests, deduplicated by its query key, so this costs no second
 * round trip.
 */
function useFragmentOutline(fragmentId: string, locale: string): readonly MDXHeading[] {
  const { data: entry } = useLocalizedContent(fragmentId, locale);
  const mdx = entry?.localized?.content?.mdx ?? null;
  const { data } = useCompileMDX({ mdxContent: mdx, cacheKey: entry?.localized?.etag });
  return data?.outline ?? [];
}

/**
 * Wrap a host block's own render so the editor canvas previews the selected
 * fragment inside the site's markup instead of the package's.
 *
 * `fragment` stays undefined for an id that matches no fragment in the page's
 * locale, as the published renderer does, so the site's placeholder shows.
 */
function withFragmentPreview(
  hostRender: PuckComponent<ContentFragmentSectionProps>,
  resolvable: ReadonlySet<string>,
  locale: string,
): PuckComponent<ContentFragmentSectionProps> {
  // Rendered, never called: a site may ship its block as memo(...) or
  // forwardRef(...), and those are objects React renders but nothing invokes.
  const HostBlock = hostRender;

  return (props) => {
    const fragmentOutline = useFragmentOutline(props.fragmentId, locale);

    return (
      <HostBlock
        {...props}
        fragmentOutline={fragmentOutline}
        fragment={
          resolvable.has(props.fragmentId) ? (
            <div className="mdx-content conloca-prose" data-conloca-content-root="">
              <FragmentContentWrapper contentId={props.fragmentId} locale={locale} />
            </div>
          ) : undefined
        }
      />
    );
  };
}

/**
 * Build the editor's Puck config for the page's locale: register every
 * fragment as its own block, swap the host `ContentFragmentSection`'s
 * `fragmentId` field for the fragment picker, and hand the selected fragment
 * to the host's own render.
 *
 * Either block sits the fragment in the same content-root element the
 * published page uses, so a fragment looks the same whichever one holds it.
 * Unlike the published page, the editor also previews fragments that are not
 * published yet: only a missing locale version counts as missing here.
 */
export function enhancePuckConfigWithFragments(
  puckConfig: Config,
  fragments: ContentManifest[],
  locale: string,
): Config {
  const fragmentOptions: ContentFragmentOption[] = fragments.map((fragment) => {
    const locales = Object.keys(fragment.locales);
    const firstLocale = locales.length > 0 ? fragment.locales[locales[0]] : null;
    const label = firstLocale?.meta?.title || firstLocale?.name || fragment.id;

    return {
      value: fragment.id,
      label,
      description: firstLocale?.meta?.description,
      category: metaString(firstLocale?.meta?.category),
    };
  });

  const fragmentComponents: Record<string, ComponentConfig<{ contentId: string }>> = {};
  const fragmentCategoryList: string[] = [];

  fragments.forEach((fragment) => {
    const componentKey = `Fragment_${fragment.id}`;
    const locales = Object.keys(fragment.locales);
    const firstLocale = locales.length > 0 ? fragment.locales[locales[0]] : null;
    const fragmentTitle = firstLocale?.meta?.title || firstLocale?.name || fragment.id;

    fragmentComponents[componentKey] = {
      label: fragmentTitle,
      fields: {
        contentId: {
          type: 'custom',
          label: 'Content Fragment',
          render: ({ value }: { value: string }) => <FragmentFieldWrapper contentId={value} />,
        },
      },
      defaultProps: { contentId: fragment.id },
      render: ({ contentId }: { contentId: string }) => (
        <div className="mdx-content conloca-prose" data-conloca-content-root="">
          <FragmentContentWrapper contentId={contentId} locale={locale} />
        </div>
      ),
    };
    fragmentCategoryList.push(componentKey);
  });

  const existingCategories = puckConfig.categories || {};
  const existingComponents = puckConfig.components || {};
  const contentFragmentSection = existingComponents.ContentFragmentSection;
  const resolvable = new Set(fragments.filter((fragment) => fragment.locales[locale]).map((fragment) => fragment.id));

  const enhancedContentFragmentSection = contentFragmentSection
    ? {
        ...contentFragmentSection,
        fields: {
          ...contentFragmentSection.fields,
          fragmentId: {
            type: 'custom',
            label: 'Content Fragment',
            render: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
              <ContentFragmentSelectorField value={value} onChange={onChange} options={fragmentOptions} />
            ),
          },
        },
        render: withFragmentPreview(contentFragmentSection.render, resolvable, locale),
      }
    : undefined;

  const components: Config['components'] = {
    ...existingComponents,
    ...(enhancedContentFragmentSection && { ContentFragmentSection: enhancedContentFragmentSection }),
    ...fragmentComponents,
  };
  return {
    ...puckConfig,
    categories: {
      ...existingCategories,
      fragments: {
        title: 'Fragments',
        components: fragmentCategoryList,
      },
    },
    components,
  };
}

/**
 * Wrapper component for PageEditor that loads and pre-resolves data.
 *
 * Key insight: Puck's internal resolveData only runs on mount and doesn't
 * react to metadata prop changes. To ensure data-bound components (like
 * BlogPostGrid) receive their data, we must pre-resolve using resolveAllData
 * BEFORE passing data to Puck. This matches the production renderer behavior
 * in page-handler.astro.
 */
/**
 * Top-level page editor entry. Loads the page manifest just enough to dispatch
 * to the right inner editor based on `type`:
 *  - 'mdx'  → MdxPageEditor (page-route MDX editor, mirrors FragmentEditor)
 *  - 'puck' → PuckPageEditorInner (the existing Puck flow, unchanged below)
 *
 * Splitting like this keeps the heavier Puck-only hooks (useFragments,
 * useDataContext, resolveAllData) out of the mdx-page render path so
 * Rules of Hooks aren't violated by an early return.
 */
/**
 * Terminal load-failure screen for the page editors. Mirrors
 * FragmentEditor's failure state: say what happened and offer a way back —
 * a dead end here strands the user on a full-screen editor route with
 * no navigation chrome.
 */
function PageLoadFailure({ message }: { message?: string }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <div className="text-red-04 dark:text-red-08">Failed to load page: {message || 'Not found'}</div>
      <button
        type="button"
        onClick={() => navigate('/pages')}
        className="px-4 py-2 bg-azure-04 text-white rounded-md hover:bg-azure-03 transition-colors"
      >
        Back to Pages
      </button>
    </div>
  );
}

export function PageEditorWrapper({ puckConfig }: PageEditorWrapperProps) {
  const { id } = useParams();
  // Use the kind-level hook so dispatch works regardless of which locales
  // exist for the page (a previous `useLocalizedContent(id, 'en')` would
  // stall on the loading branch for any page that exists only in non-en
  // locales — the headline use case for `mdxPagesDefaultLocale`).
  const { data: content, isLoading, error } = useContent(id || '');

  // Failure first: a failed load never produces content, so checking
  // the loading state first would spin forever with no error and no
  // way back (for example an entry the content API cannot serve).
  if (error || (!isLoading && !content)) {
    return <PageLoadFailure message={error?.message} />;
  }

  if (isLoading || !content) {
    return <div className="flex items-center justify-center h-full">Loading...</div>;
  }

  if (content.type === 'mdx') {
    return <MdxPageEditor />;
  }

  return <PuckPageEditorInner puckConfig={puckConfig} />;
}

function PuckPageEditorInner({ puckConfig }: PageEditorWrapperProps) {
  const { id } = useParams();
  const navigate = useNavigate();
  const updateContent = useUpdateLocalized();

  // Mirrors FragmentEditor / MdxPageEditor: derive the locale list from the
  // host's sites config and let the editor switch between them. Initial
  // value is `'en'` for parity with the sibling editors; on a site whose
  // globalLocales don't include 'en', the user picks an available locale
  // from the switcher PageEditor renders when availableLocales.length > 1.
  const [currentLocale, setCurrentLocale] = useState<string>('en');
  const { data: sitesConfig } = useSitesConfig();
  const availableLocales = sitesConfig?.globalLocales || ['en'];

  // Load page content for the active locale.
  const { data: content, isLoading: isLoadingContent, error } = useLocalizedContent(id || '', currentLocale);

  // Load user-created fragments for config enhancement
  const { data: fragmentsData } = useFragments();

  // The page being edited, as its blocks read it from the data context. Built
  // from every load of the page, so a Page settings save reaches the canvas.
  const page = useMemo(() => (content?.localized ? pageReferenceOf(content, content.localized) : undefined), [content]);

  // Build the data context blocks resolve and render against (the page, and
  // what its route binds, e.g. BlogPostGrid's feed) from the site's routing
  // bindings, as the published page does.
  const {
    data: dataContext,
    error: dataContextError,
    isLoading: isLoadingDataContext,
  } = useDataContext(page, getUIConfig().dataBindings);

  // Store current ETag for optimistic locking
  const [currentEtag, setCurrentEtag] = useState<string>('');

  // Metadata dialog state, and the field it opens at when a block's part on the canvas opened it
  const [metadataDialogOpen, setMetadataDialogOpen] = useState(false);
  const [metadataFocusField, setMetadataFocusField] = useState<string>();

  // Pre-resolved Puck data (resolved BEFORE passing to Puck)
  const [resolvedPuckData, setResolvedPuckData] = useState<Data | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  useEffect(() => {
    if (content?.localized?.etag) {
      setCurrentEtag(content.localized.etag);
    }
  }, [content]);

  // Enhance Puck config with user-created fragments, read in the page's locale
  const enhancedConfig = useMemo(() => {
    if (!puckConfig || !fragmentsData?.items) return puckConfig;
    return enhancePuckConfigWithFragments(puckConfig, fragmentsData.items, currentLocale);
  }, [puckConfig, fragmentsData, currentLocale]);
  const puckData = content?.localized?.content?.puckData;

  // Resolving again replaces the editor, unsaved block edits included, so it
  // runs when the blocks or the data their route binds change, and reads the
  // page when it runs: a Page settings save changes only the page, which the
  // canvas takes from `metadata` without remounting.
  const dataContextRef = useRef(dataContext);
  dataContextRef.current = dataContext;
  const routeCollections = dataContext?.collections;
  const routePages = dataContext?.pages;

  // Pre-resolve component data using resolveAllData.
  // This runs each component's resolveData with the data context as its
  // metadata, ensuring data-bound components have their data BEFORE Puck mounts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the route's bound data is the event; the page is read through the ref.
  useEffect(() => {
    let cancelled = false;

    if (!puckData || !enhancedConfig) {
      setResolvedPuckData(null);
      return;
    }

    const mergedData = mergeDefaultProps(puckData, enhancedConfig);

    // Always resolve — pass the data context when available, matching the production pattern in page-handler.astro
    setIsResolving(true);
    resolveAllData(mergedData, enhancedConfig, dataContextRef.current ?? undefined)
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
  }, [puckData, enhancedConfig, routeCollections, routePages]);

  const pageMetadata = useMemo(() => (content?.localized ? extractPageMetadata(content) : null), [content]);

  // Failure first: a failed localized fetch (entry the backend can't
  // serve, or a locale with no variant after a switch) never produces
  // content, so the loading guard below would otherwise win forever.
  // Guarded on !isLoadingContent so the normal first render (content
  // still undefined) keeps showing the splash, not a flash of error.
  if (error || (!isLoadingContent && !content?.localized)) {
    return <PageLoadFailure message={error?.message} />;
  }

  // Blocks resolved without the data their route binds would show a page
  // that differs from the published one without saying so.
  if (dataContextError) {
    return <PageLoadFailure message={dataContextError.message} />;
  }

  // Show loading while fetching or resolving
  if (isLoadingContent || isLoadingDataContext || isResolving || !resolvedPuckData) {
    return <div className="flex items-center justify-center h-full">Loading...</div>;
  }

  if (!content?.localized) {
    return <PageLoadFailure />;
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
        entry={entryWithResolvedData}
        config={enhancedConfig}
        // The data context for Puck's internal resolveData (field changes, etc.)
        // and for every block's render, as `puck.metadata`
        metadata={dataContext ?? undefined}
        availableLocales={availableLocales}
        onLocaleChange={setCurrentLocale}
        onSave={async (newData, forceEtag) => {
          try {
            const result = await updateContent.mutateAsync({
              id: content.id,
              locale: currentLocale,
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
            // astro-cms's content router answers a stale PUT with 412 and
            // the client throws it; a storage client may resolve with
            // reason 'stale_write' instead. Flattening the thrown form to
            // write_error would hide the conflict dialog — and the
            // forced-save path behind it — from every astro-cms editor.
            if (error instanceof StaleWriteError) {
              return {
                success: false,
                reason: 'stale_write' as const,
                currentEtag: error.currentEtag,
                error,
              };
            }
            console.error('Failed to save page:', error);
            return {
              success: false,
              reason: 'write_error' as const,
              error: error as Error,
            };
          }
        }}
        onBack={() => navigate('/pages')}
        onOpenMetadata={(field) => {
          setMetadataFocusField(field);
          setMetadataDialogOpen(true);
        }}
        onReload={() => {
          window.location.reload();
        }}
      />

      <PageMetadataDialog
        open={metadataDialogOpen}
        onOpenChange={setMetadataDialogOpen}
        focusField={metadataFocusField}
        page={pageMetadata!}
        onSave={async (metadata: PageMetadata) => {
          const result = await updateContent.mutateAsync({
            id: content.id,
            locale: currentLocale,
            data: buildMetadataUpdate(metadata),
            etag: currentEtag,
          });

          if (result.success && result.etag) {
            setCurrentEtag(result.etag);
          }
          if (!result.success) {
            // A failure must throw so the dialog stays open and shows what
            // happened; it used to stop at console.error while the dialog
            // closed. Some storage clients resolve failed writes as
            // { success: false } instead of throwing, so a resolved failure
            // must take the same exit as a thrown one — otherwise the dialog
            // closes and the lost change looks saved. Its message says why,
            // such as a new path another page already has; that message
            // arrives as plain text from a remote route, which the dialog
            // could only replace with a generic "try again".
            throw new Error(
              result.reason === 'stale_write'
                ? 'Someone else saved this page first. Close the dialog, reload to pick up their changes, then try again.'
                : contentFailureMessage(result, 'Saving the page settings failed.'),
            );
          }
        }}
      />
    </>
  );
}
