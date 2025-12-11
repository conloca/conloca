import { Database, Edit2, ExternalLink, FileJson, MoreVertical, Settings, Trash2 } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useClickOutside } from '../../hooks';
import { getUIConfig } from '../../ui-config';

interface DataEntryCardProps {
  id: string;
  title: string;
  description?: string;
  collection: string;
  locales: string[];
  name?: string;
  onEditData: () => void;
  onEditProperties: () => void;
  onDelete: () => void;
}

/**
 * Generates a VSCode URI to open a data file.
 * Uses vscode:// protocol which works when VSCode is installed.
 * Note: Data files don't have locale suffix (unlike pages/blocks).
 */
function getEditorLink(projectRoot: string, collection: string, name: string): string {
  const filePath = `${projectRoot}/content/data/${collection}/${name}.json`;
  return `vscode://file${filePath}`;
}

export function DataEntryCard({
  id,
  title,
  description,
  collection,
  locales,
  name,
  onEditData,
  onEditProperties,
  onDelete,
}: DataEntryCardProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setIsMenuOpen(false), []);
  useClickOutside(menuRef, closeMenu, isMenuOpen);

  const config = getUIConfig();
  const editorLink = config.projectRoot && name ? getEditorLink(config.projectRoot, collection, name) : null;

  return (
    <div className="bg-white border border-grey-09 rounded p-4 hover:border-azure-04 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-grey-04" />
          <h3 className="font-medium" data-testid={`data-title-${id}`}>
            {title}
          </h3>
        </div>
        <span className="px-2 py-1 text-xs bg-grey-11 rounded">{collection}</span>
      </div>

      {description && (
        <p className="text-sm text-grey-04 mb-3 line-clamp-2" data-testid={`data-description-${id}`}>
          {description}
        </p>
      )}

      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {locales.map((locale) => (
            <span key={locale} data-testid="locale-indicator" className="px-2 py-1 text-xs bg-grey-11 rounded">
              {locale}
            </span>
          ))}
        </div>

        <div className="flex gap-2 relative">
          <button onClick={onEditData} className="p-1 hover:bg-grey-11 rounded transition-colors" title="Edit data">
            <Edit2 className="h-4 w-4 text-azure-04" />
          </button>
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-1 hover:bg-grey-11 rounded transition-colors"
            title="More actions"
            aria-label="More actions"
          >
            <MoreVertical className="h-4 w-4 text-grey-04" />
          </button>

          {/* Dropdown Menu */}
          {isMenuOpen && (
            <div
              ref={menuRef}
              className="absolute right-0 top-8 w-48 bg-white border border-grey-09 rounded shadow-lg z-10"
            >
              <button
                onClick={() => {
                  onEditData();
                  setIsMenuOpen(false);
                }}
                className="w-full px-4 py-2 text-left flex items-center gap-2 hover:bg-grey-11 transition-colors"
              >
                <FileJson className="h-4 w-4 text-grey-04" />
                <span>Edit Data</span>
              </button>
              <button
                onClick={() => {
                  onEditProperties();
                  setIsMenuOpen(false);
                }}
                className="w-full px-4 py-2 text-left flex items-center gap-2 hover:bg-grey-11 transition-colors"
              >
                <Settings className="h-4 w-4 text-grey-04" />
                <span>Properties</span>
              </button>
              {editorLink && (
                <a
                  href={editorLink}
                  onClick={() => setIsMenuOpen(false)}
                  className="w-full px-4 py-2 text-left flex items-center gap-2 hover:bg-grey-11 transition-colors"
                >
                  <ExternalLink className="h-4 w-4 text-grey-04" />
                  <span>Open in Editor</span>
                </a>
              )}
              <div className="border-t border-grey-09 my-1" />
              <button
                onClick={() => {
                  onDelete();
                  setIsMenuOpen(false);
                }}
                className="w-full px-4 py-2 text-left flex items-center gap-2 hover:bg-red-50 transition-colors text-red-04"
              >
                <Trash2 className="h-4 w-4" />
                <span>Delete</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
