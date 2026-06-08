import { NavLink, Outlet } from 'react-router-dom'
import { Container, ExternalLink, Loader2, Upload, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  loading: boolean
  syncing: boolean
  error: string | null
  ghConfigured: boolean
  onSync: () => void
  onLoad: () => void
}

const navItems = [
  { to: '/mirrors', label: 'Mirrors' },
  { to: '/profiles', label: 'Profiles' },
  { to: '/settings', label: 'Settings' },
]

export function AppLayout({ loading, syncing, error, ghConfigured, onSync, onLoad }: Props) {
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
            {ghConfigured && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onLoad}
                  disabled={loading}
                >
                  {loading ? <Loader2 className="animate-spin" /> : <Download />}
                  Pull
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onSync}
                  disabled={syncing}
                >
                  {syncing ? <Loader2 className="animate-spin" /> : <Upload />}
                  Push
                </Button>
              </>
            )}
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
