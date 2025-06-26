import { type LocalizedEntry, useLocalizedContent, useUpdateLocalized } from '@conloca/content-api-client';
import { MDXEditorModal } from '@conloca/mdx-editor';
import { useEffect, useState } from 'react';
import { Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { BlockList } from './components/BlockList';
import { CMSDashboard } from './components/CMSDashboard';
import { CMSLayout } from './components/CMSLayout';
import { PageEditor } from './components/PageEditor';
import { PageList } from './components/PageList';
import './main.css';

export default function App() {
  // In development, use the mock config from the global variable
  // In production (via Astro), this will be loaded dynamically
  const [puckConfig, setPuckConfig] = useState((window as any).__PUCK_CONFIG__ || { components: {} });

  useEffect(() => {
    console.log('[App] Setting up puck config listeners');

    // Listen for Puck config updates
    const handleConfigUpdate = (event: CustomEvent) => {
      console.log('[App] Received puck config event:', event.type, event.detail);
      setPuckConfig(event.detail);
    };

    window.addEventListener('puck-config-loaded', handleConfigUpdate as EventListener);
    window.addEventListener('puck-config-updated', handleConfigUpdate as EventListener);

    // Debug Vite HMR
    if ((import.meta as any).hot) {
      (import.meta as any).hot.on('vite:ws:disconnect', () => {
        console.error('[App] Vite WebSocket disconnected!');
      });

      (import.meta as any).hot.on('vite:beforeFullReload', () => {
        console.error('[App] Vite full reload triggered!');
        console.trace();
      });
    }

    return () => {
      console.log('[App] Removing puck config listeners');
      window.removeEventListener('puck-config-loaded', handleConfigUpdate as EventListener);
      window.removeEventListener('puck-config-updated', handleConfigUpdate as EventListener);
    };
  }, []);

  return (
    <Routes>
      <Route path="/" element={<CMSLayout />}>
        <Route index element={<CMSDashboard />} />
        <Route path="pages" element={<PageList />} />
        <Route path="blocks" element={<BlockList />} />
        <Route path="test-editor" element={<TestEditor puckConfig={puckConfig} />} />
      </Route>
      <Route path="/pages/:id" element={<PageEditorWrapper puckConfig={puckConfig} />} />
      <Route path="/blocks/:id" element={<BlockEditor />} />
    </Routes>
  );
}

// Wrapper component for PageEditor that loads data
function PageEditorWrapper({ puckConfig }: { puckConfig: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const updateContent = useUpdateLocalized();

  // Load content with the ID
  const { data: content, isLoading, error } = useLocalizedContent(id || '', 'en');

  // Store the current ETag for saving
  const [currentEtag, setCurrentEtag] = useState<string>('');

  useEffect(() => {
    if (content?.localized?.etag) {
      setCurrentEtag(content.localized.etag);
    }
  }, [content]);

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
    <PageEditor
      pageId={content.id}
      entry={content}
      config={puckConfig}
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
        // TODO: Implement metadata dialog
        console.log('Open metadata dialog');
      }}
      onReload={() => {
        // Reload the page to get fresh data
        window.location.reload();
      }}
    />
  );
}

// Block editor component
function BlockEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const updateContent = useUpdateLocalized();
  const [showEditor] = useState(true);
  const [currentEtag, setCurrentEtag] = useState<string>('');

  // Load the block content with the ID
  const { data: content, isLoading, error } = useLocalizedContent(id || '', 'en');

  // Update etag when content loads
  useEffect(() => {
    if (content?.localized?.etag) {
      setCurrentEtag(content.localized.etag);
    }
  }, [content]);

  const handleSave = async (newContent: string) => {
    if (!content) return;

    try {
      const result = await updateContent.mutateAsync({
        id: content.id,
        locale: 'en',
        data: {
          content: { mdx: newContent },
        },
        etag: currentEtag,
      });

      if (result.success && result.etag) {
        console.log('Block saved successfully');
        setCurrentEtag(result.etag); // Update etag for next save
      } else if (result.reason === 'stale_write') {
        // TODO: Show conflict resolution UI
        throw new Error('Content was modified by another user. Please reload and try again.');
      } else {
        throw new Error(`Save failed: ${result.reason}`);
      }
    } catch (error) {
      console.error('Failed to save block:', error);
      // TODO: Show error notification
      throw error;
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  if (error || !content || !content.localized) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-red-500">Failed to load block: {error?.message || 'Not found'}</div>
      </div>
    );
  }

  const contentData = content.localized.content as any;
  const blockName = content.localized.name || content.id;

  return (
    <MDXEditorModal
      isOpen={showEditor}
      onClose={() => navigate('/blocks')}
      filePath={`blocks/${blockName}`}
      initialContent={contentData?.mdx || '# New Block\n\n'}
      onSave={handleSave}
    />
  );
}

// Test editor component for HMR testing
function TestEditor({ puckConfig }: { puckConfig: any }) {
  const navigate = useNavigate();
  const [data, setData] = useState({
    content: [],
    root: {},
    zones: {},
  });

  console.log('[TestEditor] Puck config:', puckConfig);

  // Create a mock LocalizedEntry for testing
  const mockEntry: LocalizedEntry = {
    id: 'test-page',
    type: 'puck',
    kind: 'page',
    site: 'default',
    collection: 'pages',
    localized: {
      locale: 'en',
      etag: 'test-etag',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      pathname: '/test',
      meta: { title: 'Test Page' },
      content: { puckData: data },
    },
  };

  return (
    <PageEditor
      pageId="test-page"
      entry={mockEntry}
      config={puckConfig}
      availableLocales={['en']}
      onSave={async (newData) => {
        console.log('Test save:', newData);
        setData(newData);
        return { success: true, etag: 'test-etag', modified: new Date() };
      }}
      onBack={() => navigate('/')}
      onOpenMetadata={() => {
        console.log('Test metadata');
      }}
    />
  );
}
