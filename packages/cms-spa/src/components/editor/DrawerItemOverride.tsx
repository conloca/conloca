import { useGetPuck } from '@puckeditor/core';
import type { ReactNode } from 'react';

interface DrawerItemOverrideProps {
  children: ReactNode;
  name: string;
}

function generateId(componentType: string): string {
  return `${componentType}-${crypto.randomUUID()}`;
}

export function DrawerItemOverride({ children, name }: DrawerItemOverrideProps) {
  const getPuck = useGetPuck();

  const handleDoubleClick = () => {
    const puck = getPuck();
    if (!puck?.dispatch) return;

    // Use setData action to add a new component to the root content
    const currentData = puck.appState.data;
    const id = generateId(name);

    // Merge defaultProps from the component config so the new component renders correctly.
    // Puck's native drag-drop insert action does this automatically, but setData bypasses it.
    const componentConfig = puck.config?.components?.[name];
    const defaultProps = componentConfig?.defaultProps ?? {};

    const newComponent = {
      type: name,
      props: { ...defaultProps, id },
    };

    puck.dispatch({
      type: 'setData',
      data: {
        ...currentData,
        content: [...(currentData.content || []), newComponent],
      },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleDoubleClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      data-testid={`drawer-item-${name}`}
    >
      {children}
    </div>
  );
}
