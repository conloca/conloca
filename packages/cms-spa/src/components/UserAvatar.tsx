import { User } from 'lucide-react'
import { useCurrentUser } from '@conloca/content-api-client'

export function UserAvatar() {
  const { data, isLoading } = useCurrentUser()

  if (isLoading) {
    return <div className="h-8 w-8 rounded-full bg-gray-100 animate-pulse" />
  }

  if (!data?.authenticated || !data.user) {
    return (
      <div className="flex items-center gap-2 text-gray-400" title="Not authenticated">
        <User className="h-5 w-5" />
      </div>
    )
  }

  const initial = data.user.email.charAt(0).toUpperCase()

  return (
    <div className="flex items-center gap-2" title={data.user.email}>
      <div className="h-8 w-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-medium">
        {initial}
      </div>
    </div>
  )
}
