import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { CMSDashboard } from './components/CMSDashboard';
import { CMSLayout } from './components/CMSLayout';
import { BlockEditor } from './components/editor/BlockEditor';
import { PageEditorWrapper } from './components/editor/PageEditorWrapper';
import { TestEditor } from './components/editor/TestEditor';
import { BlockList } from './components/pages/BlockList';
import { DataList } from './components/pages/DataList';
import { PageList } from './components/pages/PageList';
import type { DataSchemas } from './data-schemas';
import './main.css';

export default function App() {
  // Puck config state - loaded from virtual module
  const [puckConfig, setPuckConfig] = useState((window as any).__PUCK_CONFIG__ || { components: {} });

  // Data schemas state - loaded from virtual module
  const [dataSchemas, setDataSchemas] = useState<DataSchemas>(() => (window as any).__DATA_SCHEMAS__ || {});

  // Puck config listener
  useEffect(() => {
    console.log('[App] Setting up puck config listeners');
    console.log('[App] Initial __PUCK_CONFIG__:', (window as any).__PUCK_CONFIG__);

    // Check if config is already loaded (race condition)
    if ((window as any).__PUCK_CONFIG__ && Object.keys((window as any).__PUCK_CONFIG__.components || {}).length > 0) {
      console.log('[App] Config already loaded, setting state');
      setPuckConfig((window as any).__PUCK_CONFIG__);
    }

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

  // Data schemas listener
  useEffect(() => {
    // Check if schemas were already loaded (race condition)
    const current = (window as any).__DATA_SCHEMAS__;
    if (current && Object.keys(current).length > 0 && Object.keys(dataSchemas).length === 0) {
      setDataSchemas(current);
    }

    // Listen for schema updates
    const handleSchemasUpdate = (event: CustomEvent<DataSchemas>) => {
      setDataSchemas(event.detail);
    };

    window.addEventListener('data-schemas-loaded', handleSchemasUpdate as EventListener);
    window.addEventListener('data-schemas-updated', handleSchemasUpdate as EventListener);

    return () => {
      window.removeEventListener('data-schemas-loaded', handleSchemasUpdate as EventListener);
      window.removeEventListener('data-schemas-updated', handleSchemasUpdate as EventListener);
    };
  }, []);

  return (
    <Routes>
      <Route path="/" element={<CMSLayout />}>
        <Route index element={<CMSDashboard />} />
        <Route path="pages" element={<PageList />} />
        <Route path="blocks">
          <Route index element={<BlockList />} />
          <Route path=":id" element={<BlockEditor />} />
        </Route>
        <Route path="data" element={<DataList dataSchemas={dataSchemas} />} />
        <Route path="test-editor" element={<TestEditor puckConfig={puckConfig} />} />
      </Route>
      <Route path="/pages/:id" element={<PageEditorWrapper puckConfig={puckConfig} />} />
    </Routes>
  );
}
