import { ChevronRight, Home } from 'lucide-react';

interface FolderNavProps {
  currentFolder: string;
  onNavigate: (path: string) => void;
}

export function FolderNav({ currentFolder, onNavigate }: FolderNavProps) {
  // Split path into segments, filter out empty strings
  const segments = currentFolder.split('/').filter(Boolean);

  // Build clickable breadcrumb items
  const breadcrumbs = segments.map((segment, index) => {
    const path = '/' + segments.slice(0, index + 1).join('/');
    return { name: segment, path };
  });

  return (
    <nav className="flex items-center gap-1 text-sm text-gray-600">
      <button
        type="button"
        onClick={() => onNavigate('/')}
        className="flex items-center gap-1 hover:text-blue-600 transition-colors"
        title="Root assets folder"
      >
        <Home className="w-4 h-4" />
        <span>Assets</span>
      </button>

      {breadcrumbs.map((crumb) => (
        <span key={crumb.path} className="flex items-center gap-1">
          <ChevronRight className="w-4 h-4 text-gray-400" />
          <button
            type="button"
            onClick={() => onNavigate(crumb.path)}
            className="hover:text-blue-600 transition-colors"
          >
            {crumb.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
