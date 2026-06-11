import { NavLink, Outlet } from 'react-router-dom'
import { Container, ExternalLink, Loader2, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'
import type { User } from '@/hooks/useAuth'

interface Props {
  loading: boolean
  syncing: boolean
  error: string | null
  user: User
  onLogout: () => Promise<void>
}

const navItems = [
  { to: '/mirrors', label: 'Mirrors' },
  { to: '/profiles', label: 'Profiles' },
  { to: '/jobs', label: 'Jobs' },
  { to: '/settings', label: 'Settings' },
]

export function AppLayout({ loading, syncing, error, user, onLogout }: Props) {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('mirrorpilot.theme') === 'dark' ||
      (!localStorage.getItem('mirrorpilot.theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('mirrorpilot.theme', dark ? 'dark' : 'light')
  }, [dark])

  return (
    <div className="bg-background min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Container className="size-6" />
              <h1 className="text-lg font-semibold">MirrorPilot</h1>
            </div>
            <nav className="flex items-center gap-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            {(loading || syncing) && (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
            <div className="flex items-center gap-2">
              <img
                src={user.avatar_url}
                alt={user.name}
                className="size-7 rounded-full border object-cover"
              />
              <span className="hidden max-w-[180px] truncate text-xs text-muted-foreground md:inline" title={user.email}>
                {user.email}
              </span>
              <Button variant="outline" size="sm" onClick={onLogout}>
                Logout
              </Button>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setDark(!dark)} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
              {dark ? <Sun /> : <Moon />}
            </Button>
            <Button variant="ghost" size="icon" asChild>
              <a
                href="https://github.com/warjiang/MirrorPilot"
                target="_blank"
                rel="noreferrer"
                title="GitHub"
              >
                <ExternalLink />
              </a>
            </Button>
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-auto max-w-5xl px-4 pt-4">
          <div className="bg-destructive/10 text-destructive rounded-md px-4 py-2 text-sm">
            {error}
          </div>
        </div>
      )}

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
