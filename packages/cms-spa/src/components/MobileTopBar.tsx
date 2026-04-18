import { Menu } from 'lucide-react';
import { ConlocaLogo } from './ConlocaLogo';

interface MobileTopBarProps {
  onMenuClick: () => void;
}

export function MobileTopBar({ onMenuClick }: MobileTopBarProps) {
  return (
    <header className="md:hidden flex items-center gap-3 px-3 py-2 border-b border-grey-09 dark:border-grey-03 bg-white dark:bg-grey-02">
      <button
        type="button"
        onClick={onMenuClick}
        className="p-2 rounded-md text-grey-04 hover:bg-grey-11 hover:text-grey-01 dark:text-grey-07 dark:hover:bg-grey-03 dark:hover:text-grey-12 transition-colors"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>
      <ConlocaLogo />
    </header>
  );
}
