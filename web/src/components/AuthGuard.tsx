import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import type { User } from '@/hooks/useAuth'

interface AuthGuardProps {
  children: (auth: { user: User; logout: () => Promise<void> }) => ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { user, loading, logout } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/" replace />
  }

  return <>{children({ user, logout })}</>
}
