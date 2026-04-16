import { useCurrentUser } from '@conloca/content-api-client';
import { User } from 'lucide-react';

export function UserAvatar() {
  const { data, isLoading } = useCurrentUser();

  if (isLoading) {
    return <div className="h-8 w-8 rounded-full bg-grey-11 dark:bg-grey-03 animate-pulse" />;
  }

  if (!data?.authenticated || !data.user) {
    return (
      <div className="flex items-center gap-2 text-grey-06 dark:text-grey-05" title="Not authenticated">
        <User className="h-5 w-5" />
      </div>
    );
  }

  const initial = data.user.email.charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-2" title={data.user.email}>
      <div className="h-8 w-8 rounded-full bg-azure-04 text-white flex items-center justify-center text-sm font-medium">
        {initial}
      </div>
    </div>
  );
}
