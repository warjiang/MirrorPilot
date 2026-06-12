import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'

/** Renders children only for admin users; others are redirected to /images. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!user || user.is_admin !== 1) {
    return <Navigate to="/images" replace />
  }
  return <>{children}</>
}
