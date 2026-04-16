import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function CMSLayout() {
  return (
    <div className="flex h-screen bg-grey-12 dark:bg-grey-01">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
