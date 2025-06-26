import type { ContentData } from '@conloca/content-api-client';
import { useState } from 'react';

interface ContentDiffProps {
  localContent: ContentData;
  serverContent: ContentData;
  onResolve?: (resolvedContent: ContentData) => void;
  editable?: boolean;
}

export function ContentDiff({ localContent, serverContent, onResolve, editable = false }: ContentDiffProps) {
  // Determine content type
  const isMDX = localContent.mdx !== undefined || serverContent.mdx !== undefined;
  const isPuck = localContent.puckData !== undefined || serverContent.puckData !== undefined;

  if (isMDX) {
    return (
      <MDXDiff
        localMdx={localContent.mdx || ''}
        serverMdx={serverContent.mdx || ''}
        onResolve={editable ? (resolved) => onResolve?.({ mdx: resolved }) : undefined}
      />
    );
  }

  if (isPuck) {
    return (
      <PuckDiff
        localPuck={localContent.puckData}
        serverPuck={serverContent.puckData}
        onResolve={editable ? (resolved) => onResolve?.({ puckData: resolved }) : undefined}
      />
    );
  }

  return <div className="text-gray-500">No content to diff</div>;
}

interface MDXDiffProps {
  localMdx: string;
  serverMdx: string;
  onResolve?: (resolved: string) => void;
}

function MDXDiff({ localMdx, serverMdx, onResolve }: MDXDiffProps) {
  const [editableContent, setEditableContent] = useState<string | null>(null);

  // Create git-style conflict markers
  const conflictContent = createMDXConflictMarkers(localMdx, serverMdx);

  const displayContent = editableContent ?? conflictContent;
  const isEditing = editableContent !== null;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">MDX Content Conflict</h3>
        <div className="flex gap-2">
          {!isEditing && onResolve && (
            <button
              onClick={() => setEditableContent(conflictContent)}
              className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Edit to Resolve
            </button>
          )}
          {isEditing && (
            <>
              <button
                onClick={() => {
                  onResolve?.(displayContent);
                  setEditableContent(null);
                }}
                className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600"
              >
                Accept Resolution
              </button>
              <button
                onClick={() => setEditableContent(null)}
                className="px-3 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {isEditing ? (
        <textarea
          value={displayContent}
          onChange={(e) => setEditableContent(e.target.value)}
          className="w-full h-96 p-4 border rounded font-mono text-sm"
          placeholder="Resolve the conflict by editing the content..."
        />
      ) : (
        <pre className="p-4 bg-gray-50 rounded border overflow-x-auto text-sm font-mono whitespace-pre-wrap">
          {displayContent}
        </pre>
      )}

      <div className="text-sm text-gray-600">
        <p>
          <strong>Instructions:</strong> Resolve conflicts by:
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            Remove the conflict markers (<code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code>, <code>=======</code>,{' '}
            <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code>)
          </li>
          <li>Keep the content you want from either version</li>
          <li>Edit as needed to create the final version</li>
        </ul>
      </div>
    </div>
  );
}

interface PuckDiffProps {
  localPuck: any;
  serverPuck: any;
  onResolve?: (resolved: any) => void;
}

function PuckDiff({ localPuck, serverPuck, onResolve }: PuckDiffProps) {
  const [selectedVersion, setSelectedVersion] = useState<'local' | 'server' | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">Puck Content Conflict</h3>
        {onResolve && selectedVersion && (
          <button
            onClick={() => onResolve(selectedVersion === 'local' ? localPuck : serverPuck)}
            className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600"
          >
            Use {selectedVersion === 'local' ? 'Your' : 'Server'} Version
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div
          className={`p-4 rounded border-2 cursor-pointer transition-colors ${
            selectedVersion === 'local'
              ? 'border-green-500 bg-green-50'
              : 'border-gray-200 bg-gray-50 hover:border-gray-300'
          }`}
          onClick={() => setSelectedVersion('local')}
        >
          <h4 className="font-semibold mb-2 flex items-center gap-2">
            <input type="radio" checked={selectedVersion === 'local'} onChange={() => setSelectedVersion('local')} />
            <span data-testid="conflict-comparison-yours">Your Version</span>
          </h4>
          <div className="text-sm">
            <ComponentStructure data={localPuck} />
          </div>
        </div>

        <div
          className={`p-4 rounded border-2 cursor-pointer transition-colors ${
            selectedVersion === 'server'
              ? 'border-red-500 bg-red-50'
              : 'border-gray-200 bg-gray-50 hover:border-gray-300'
          }`}
          onClick={() => setSelectedVersion('server')}
        >
          <h4 className="font-semibold mb-2 flex items-center gap-2">
            <input type="radio" checked={selectedVersion === 'server'} onChange={() => setSelectedVersion('server')} />
            <span data-testid="conflict-comparison-server">Server Version</span>
          </h4>
          <div className="text-sm">
            <ComponentStructure data={serverPuck} />
          </div>
        </div>
      </div>

      <div className="text-sm text-gray-600">
        <p>
          <strong>Instructions:</strong> Select the version you want to keep. For Puck content, you typically need to
          choose one complete version rather than merging.
        </p>
      </div>
    </div>
  );
}

// Helper component to show Puck component structure
function ComponentStructure({ data }: { data: any }) {
  if (!data || !data.content) {
    return <div className="text-gray-400">No content</div>;
  }

  const componentCount = data.content?.length || 0;
  const rootProps = data.root || {};

  return (
    <div className="space-y-2">
      <div>
        <strong>Components:</strong> {componentCount}
      </div>
      {data.root?.title && (
        <div>
          <strong>Page Title:</strong> {data.root.title}
        </div>
      )}
      {Object.keys(rootProps).length > 0 && (
        <details className="cursor-pointer">
          <summary className="font-medium">Root Properties</summary>
          <pre className="mt-1 text-xs overflow-x-auto">{JSON.stringify(rootProps, null, 2)}</pre>
        </details>
      )}
      {componentCount > 0 && (
        <details className="cursor-pointer">
          <summary className="font-medium">Components</summary>
          <div className="mt-1 space-y-1">
            {data.content.map((component: any, i: number) => (
              <div key={i} className="text-xs p-2 bg-white rounded">
                <strong>{component.type || 'Unknown'}</strong>
                {component.props?.title && ` - ${component.props.title}`}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// Create git-style conflict markers for MDX content
function createMDXConflictMarkers(localMdx: string, serverMdx: string): string {
  // For now, if content differs, show full conflict
  if (localMdx.trim() === serverMdx.trim()) {
    return localMdx; // No conflict
  }

  return ['<<<<<<< Your changes', localMdx, '=======', serverMdx, '>>>>>>> Server changes'].join('\n');
}
