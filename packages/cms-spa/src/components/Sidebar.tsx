import * as Dialog from '@radix-ui/react-dialog';
import { Database, FileText, ImageIcon, LayoutDashboard, Monitor, Moon, Package, Sun, X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { getUIConfig } from '../ui-config';
import { cn } from '../utils/cn';
import { ConlocaLogo } from './ConlocaLogo';
import { GitStatusPanel } from './GitStatusPanel';
import { UserAvatar } from './UserAvatar';

interface NavItemProps {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  end?: boolean;
}

function NavItem({ to, icon: Icon, label, end }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
          isActive
            ? 'text-grey-01 dark:text-grey-12 font-medium bg-grey-11 dark:bg-grey-03 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:bg-azure-04 before:dark:bg-azure-06 before:rounded-r-full'
            : 'font-medium text-grey-04 hover:bg-grey-11 hover:text-grey-01 dark:text-grey-07 dark:hover:bg-grey-03 dark:hover:text-grey-12',
        )
      }
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span>{label}</span>
    </NavLink>
  );
}

const themeOrder = ['system', 'light', 'dark'] as const;
const themeIcons = { system: Monitor, light: Sun, dark: Moon } as const;
const themeLabels = { system: 'System', light: 'Light', dark: 'Dark' } as const;

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = themeIcons[theme];

  const cycleTheme = () => {
    const idx = themeOrder.indexOf(theme);
    setTheme(themeOrder[(idx + 1) % themeOrder.length]);
  };

  return (
    <button
      type="button"
      onClick={cycleTheme}
      className="flex items-center justify-center p-2 rounded-md text-grey-04 hover:bg-grey-11 hover:text-grey-01 dark:text-grey-07 dark:hover:bg-grey-03 dark:hover:text-grey-12 transition-colors"
      title={`Theme: ${themeLabels[theme]} (click to cycle)`}
      aria-label={`Theme: ${themeLabels[theme]}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function SidebarContent() {
  // In hosted mode the host shell owns workspace identity/account/state UI,
  // so cms-spa hides its standalone widgets to avoid duplication. Branding
  // and theme remain because cms-spa is the only chrome in hosted mode too.
  const hosted = getUIConfig().hosted === true;
  return (
    <>
      <div className="px-4 py-5 border-b border-grey-09 dark:border-grey-03">
        <ConlocaLogo />
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <NavItem to="/" icon={LayoutDashboard} label="Dashboard" end />
        <NavItem to="/pages" icon={FileText} label="Pages" />
        <NavItem to="/media" icon={ImageIcon} label="Media" />
        <NavItem to="/blocks" icon={Package} label="Blocks" />
        <NavItem to="/data" icon={Database} label="Data" />
      </nav>

      {!hosted && (
        <div className="px-3 py-3 border-t border-grey-09 dark:border-grey-03">
          <GitStatusPanel variant="sidebar" />
        </div>
      )}

      <div className="px-3 py-3 border-t border-grey-09 dark:border-grey-03 flex items-center justify-between">
        {hosted ? <span /> : <UserAvatar />}
        <ThemeToggle />
      </div>
    </>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden md:flex w-60 flex-shrink-0 h-screen flex-col border-r border-grey-09 bg-white dark:border-grey-03 dark:bg-grey-02">
      <SidebarContent />
    </aside>
  );
}

interface SidebarDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SidebarDrawer({ open, onOpenChange }: SidebarDrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <Dialog.Content
          aria-describedby={undefined}
          className="md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[80vw] flex flex-col border-r border-grey-09 dark:border-grey-03 bg-white dark:bg-grey-02 shadow-2xl data-[state=open]:animate-slide-in-left data-[state=closed]:animate-slide-out-left"
        >
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <Dialog.Close
            className="absolute top-3 right-3 z-10 p-1 rounded-md text-grey-04 hover:bg-grey-11 hover:text-grey-01 dark:text-grey-07 dark:hover:bg-grey-03 dark:hover:text-grey-12 transition-colors"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </Dialog.Close>
          <SidebarContent />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
