import { FileText, LayoutDashboard, Package, TestTube } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '../lib/utils';

export function CMSLayout() {
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="px-6 py-4">
          <h1 className="text-xl font-semibold">Conloca CMS</h1>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex px-6">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 px-4 py-3 border-b-2 -mb-px transition-colors',
                isActive ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900',
              )
            }
          >
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </NavLink>

          <NavLink
            to="/pages"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 px-4 py-3 border-b-2 -mb-px transition-colors',
                isActive ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900',
              )
            }
          >
            <FileText className="h-4 w-4" />
            Pages
          </NavLink>

          <NavLink
            to="/blocks"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 px-4 py-3 border-b-2 -mb-px transition-colors',
                isActive ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900',
              )
            }
          >
            <Package className="h-4 w-4" />
            Blocks
          </NavLink>

          <NavLink
            to="/test-editor"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 px-4 py-3 border-b-2 -mb-px transition-colors',
                isActive ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900',
              )
            }
          >
            <TestTube className="h-4 w-4" />
            Test Editor
          </NavLink>
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
