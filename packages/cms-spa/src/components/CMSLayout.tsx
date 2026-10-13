import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { MobileTopBar } from './MobileTopBar.js';
import { Sidebar, SidebarDrawer } from './Sidebar.js';

export function CMSLayout() {
  const [drawerPathname, setDrawerPathname] = useState<string | null>(null);
  const location = useLocation();
  const drawerOpen = drawerPathname === location.pathname;

  const setDrawerOpen = (open: boolean) => {
    setDrawerPathname(open ? location.pathname : null);
  };

  return (
    <div className="flex max-md:flex-col h-full min-h-0 bg-grey-12 dark:bg-grey-01">
      <MobileTopBar onMenuClick={() => setDrawerOpen(true)} />
      <SidebarDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      <Sidebar />
      <main className="flex-1 min-h-0 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
