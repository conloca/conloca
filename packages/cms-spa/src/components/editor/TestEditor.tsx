import type { LocalizedEntry } from '@conloca/content-api-client';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageEditor } from './PageEditor';

interface TestEditorProps {
  puckConfig: any;
}

/**
 * Test editor component for HMR testing
 */
export function TestEditor({ puckConfig }: TestEditorProps) {
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
