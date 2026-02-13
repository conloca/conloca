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

    const newComponent = {
      type: name,
      props: { id },
    };

    puck.dispatch({
      type: 'setData',
      data: {
        ...currentData,
        content: [...(currentData.content || []), newComponent],
      },
    });
  };

  return (
    <div onDoubleClick={handleDoubleClick} data-testid={`drawer-item-${name}`}>
      {children}
    </div>
  );
}
