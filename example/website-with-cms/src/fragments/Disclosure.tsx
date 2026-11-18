import { withHydration } from '@conloca/astro-cms/hydration';
import { type ReactNode, useId, useState } from 'react';

// An interactive fragment component: in its own file so a page loads its chunk only when it uses it.
export const Disclosure = withHydration(function Disclosure({
  summary,
  children,
}: {
  summary: string;
  children?: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="disclosure">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {summary}
      </button>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </div>
  );
}, 'visible');
