import * as Dialog from '@radix-ui/react-dialog';
import { Database, FileText, ImageIcon, LayoutDashboard, Monitor, Moon, Package, Sun, X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme.js';
import { getUIConfig } from '../ui-config.js';
import { cn } from '../utils/cn.js';
import { ConlocaLogo } from './ConlocaLogo.js';
import { GitStatusPanel } from './GitStatusPanel.js';
import { UserAvatar } from './UserAvatar.js';

interface NavItemProps {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  end?: boolean;
  /** Optional right-aligned count badge (e.g. number of pages needing review). */
  badge?: number;
}

function NavItem({ to, icon: Icon, label, end, badge }: NavItemProps) {
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
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge > 0 ? (
        <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-semibold bg-red-04 text-white">
          <span aria-hidden="true">{badge}</span>
          <span className="sr-only">{badge} pages need review</span>
        </span>
      ) : null}
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
  // When `hosted` is set, the host app owns identity, account, status and
  // theme controls. The embedded SPA only renders those controls when it is
  // the standalone shell.
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
        <NavItem to="/fragments" icon={Package} label="Fragments" />
        <NavItem to="/data" icon={Database} label="Data" />
      </nav>

      {/* GitStatusPanel is standalone-only: it talks to the local
          content-api git endpoints on a filesystem repo with synchronous
          git ops. When `hosted` is set, the host app brings its own sync
          status surface. Do NOT try to unify them via shared hooks — the
          `hosted` flag is the seam, and it stays the seam. */}
      {!hosted && (
        <div className="px-3 py-3 border-t border-grey-09 dark:border-grey-03">
          <GitStatusPanel />
        </div>
      )}

      {!hosted && (
        <div className="px-3 py-3 border-t border-grey-09 dark:border-grey-03 flex items-center justify-between">
          <UserAvatar />
          <ThemeToggle />
        </div>
      )}
    </>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden md:flex w-60 flex-shrink-0 h-full min-h-0 flex-col border-r border-grey-09 bg-white dark:border-grey-03 dark:bg-grey-02">
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
