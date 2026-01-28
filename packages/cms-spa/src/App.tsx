import { Route, Routes } from 'react-router-dom';
import { CMSDashboard } from './components/CMSDashboard';
import { CMSLayout } from './components/CMSLayout';
import { BlockEditor } from './components/editor/BlockEditor';
import { PageEditorWrapper } from './components/editor/PageEditorWrapper';
import { BlockList } from './components/pages/BlockList';
import { DataList } from './components/pages/DataList';
import { MediaPage } from './components/pages/MediaPage';
import { PageList } from './components/pages/PageList';
import { useDataSchemas } from './data-schemas';
import './main.css';
import { usePuckConfig } from './puck-config';

export default function App() {
  const puckConfig = usePuckConfig();
  const dataSchemas = useDataSchemas();

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
        <Route path="media" element={<MediaPage />} />
      </Route>
      <Route path="/pages/:id" element={<PageEditorWrapper puckConfig={puckConfig} />} />
    </Routes>
  );
}
