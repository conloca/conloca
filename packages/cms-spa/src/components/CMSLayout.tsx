import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { MobileTopBar } from './MobileTopBar';
import { Sidebar, SidebarDrawer } from './Sidebar';

export function CMSLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex flex-col md:flex-row h-screen bg-grey-12 dark:bg-grey-01">
      <MobileTopBar onMenuClick={() => setDrawerOpen(true)} />
      <SidebarDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
