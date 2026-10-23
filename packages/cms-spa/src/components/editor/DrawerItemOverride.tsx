import { useGetPuck } from '@puckeditor/core';
import type { ReactNode } from 'react';

interface DrawerItemOverrideProps {
  children: ReactNode;
  name: string;
}

/** Puck's root drop zone, which Puck does not export as a constant. */
export const PUCK_ROOT_DROP_ZONE = 'root:default-zone';

function generateId(componentType: string): string {
  return `${componentType}-${crypto.randomUUID()}`;
}

export function DrawerItemOverride({ children, name }: DrawerItemOverrideProps) {
  const getPuck = useGetPuck();

  // Appends the block through Puck's own insert, gated by the same permission
  // that enables dragging it, so both ways of adding a block agree.
  const handleDoubleClick = () => {
    const puck = getPuck();
    if (!puck.getPermissions({ type: name }).insert) return;

    const id = generateId(name);
    puck.dispatch({
      type: 'insert',
      componentType: name,
      destinationIndex: puck.appState.data.content.length,
      destinationZone: PUCK_ROOT_DROP_ZONE,
      id,
      recordHistory: true,
    });
    puck.resolveDataById(id, 'insert');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleDoubleClick();
    } else if (e.key === ' ') {
      e.preventDefault();
      handleDoubleClick();
    }
  };

  return (
    // Not a real <button>: Puck's drag sensor refuses to start a drag from a press on an interactive element
    // (button, link, input) inside a drawer item, so a <button> here made every block in the list undraggable.
    // `block w-full`: this wrapper sits between Puck's drawer-item container
    // and the row it lays out, so a default inline-block wrapper would size to
    // its content instead of the container. A drawer item's label is as wide
    // as its text — a fragment is named after its content, so those names run
    // past the sidebar — and the label's own `text-overflow: ellipsis` can
    // only take effect while something above it is still bounded by the
    // sidebar's width. `select-none` keeps a double-click from selecting the label's text, as it never did on a button.
    // biome-ignore lint/a11y/useSemanticElements: a <button> here would stop Puck from dragging the block (see above)
    <div
      role="button"
      tabIndex={0}
      className="block w-full select-none"
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      data-testid={`drawer-item-${name}`}
    >
      {children}
    </div>
  );
}
