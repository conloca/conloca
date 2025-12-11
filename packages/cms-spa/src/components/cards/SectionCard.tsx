import { ArrowRight, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';

interface SectionCardProps {
  to: string;
  icon: ReactNode;
  title: string;
  description: string;
  count: number | undefined;
  countLabel: string;
  isLoading: boolean;
}

export function SectionCard({ to, icon, title, description, count, countLabel, isLoading }: SectionCardProps) {
  return (
    <Link
      to={to}
      className={cn(
        'group flex flex-col bg-white border border-gray-200 rounded-lg p-6',
        'hover:border-blue-400 hover:shadow-sm transition-all',
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="p-2 bg-gray-50 rounded-lg group-hover:bg-blue-50 transition-colors">{icon}</div>
        <ArrowRight className="h-5 w-5 text-gray-300 group-hover:text-blue-400 transition-colors" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-1">{title}</h3>
      <p className="text-sm text-gray-500 mb-4">{description}</p>
      <div className="mt-auto pt-4 border-t border-gray-100">
        {isLoading ? (
          <div className="flex items-center gap-2 text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        ) : (
          <p className="text-sm">
            <span className="text-2xl font-semibold text-gray-900">{count ?? 0}</span>
            <span className="text-gray-500 ml-2">{countLabel}</span>
          </p>
        )}
      </div>
    </Link>
  );
}
