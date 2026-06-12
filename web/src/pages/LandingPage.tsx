import { Navigate } from 'react-router-dom'
import {
  ArrowLeftRight,
  ArrowRight,
  Boxes,
  LayoutPanelTop,
  Workflow,
  type LucideIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmailAuthCard } from '@/components/EmailAuthCard'
import { useAuth } from '@/hooks/useAuth'

const features: Array<{
  title: string
  description: string
  icon: LucideIcon
  className?: string
}> = [
  {
    title: 'Instant Mirroring',
    description:
      'Declare the images you depend on, MirrorPilot keeps destination registries in sync without manual retagging or ad hoc scripts.',
    icon: ArrowLeftRight,
    className: 'md:col-span-2',
  },
  {
    title: 'Multi-Registry Profiles',
    description:
      'Separate credentials, endpoints, and policies across teams or environments while keeping one clean source of truth.',
    icon: Boxes,
  },
  {
    title: 'Web Dashboard',
    description:
      'Monitor sync health, inspect recent activity, and spot gaps before they interrupt builds or deployments.',
    icon: LayoutPanelTop,
  },
  {
    title: 'CI Integration',
    description:
      'Run a GitHub Actions powered mirroring pipeline that fits naturally into the release workflow you already trust.',
    icon: Workflow,
  },
]

export function LandingPage() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (user) {
    return <Navigate to="/images" replace />
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 sm:px-6 lg:px-8">
        <section className="flex flex-1 items-center border-x border-border/60 py-20 sm:py-24 lg:py-28">
          <div className="w-full border-y border-border/60 bg-muted/20 px-6 py-14 sm:px-10 lg:px-14 lg:py-18">
            <div className="grid gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,24rem)] lg:items-end">
              <div className="max-w-2xl space-y-8">
                <div className="inline-flex items-center gap-3 rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-sm text-muted-foreground">
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Boxes className="size-4" />
                  </span>
                  <span className="font-medium text-foreground">MirrorPilot</span>
                </div>

                <div className="space-y-4">
                  <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Container image mirroring made effortless
                  </p>
                  <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                    Reliable image distribution for teams that cannot afford registry drift.
                  </h1>
                  <p className="max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
                    MirrorPilot gives operators one quiet control plane for source images, registry profiles, and sync visibility, so private registries stay current without fragile shell glue.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Button asChild size="lg" className="justify-center sm:justify-start">
                    <a href="/api/auth/github">
                      Sign in with GitHub
                      <ArrowRight className="size-4" />
                    </a>
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Built for precise, repeatable sync workflows across private infrastructure.
                  </p>
                </div>
              </div>

              <div className="border border-border/70 bg-background/80 p-6 sm:p-7">
                <div className="space-y-5">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">Sign in to MirrorPilot</p>
                    <p className="text-sm text-muted-foreground">
                      Use your email or continue with GitHub.
                    </p>
                  </div>
                  <EmailAuthCard />
                  <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
                    <span className="h-px flex-1 bg-border/70" />
                    or
                    <span className="h-px flex-1 bg-border/70" />
                  </div>
                  <Button asChild variant="outline" className="w-full">
                    <a href="/api/auth/github">Sign in with GitHub</a>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-x border-b border-border/60 px-6 py-14 sm:px-10 lg:px-14 lg:py-16">
          <div className="max-w-2xl space-y-3">
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Core capabilities
            </p>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              A focused surface for mirroring operations.
            </h2>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {features.map(({ title, description, icon: Icon, className }) => (
              <Card
                key={title}
                className={[
                  'border-border/70 bg-muted/20 py-0 shadow-none',
                  className,
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <CardHeader className="gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground">
                      <Icon className="size-4" />
                    </span>
                    <CardTitle className="text-lg tracking-tight">{title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5 text-sm leading-6 text-muted-foreground sm:px-6 sm:pb-6">
                  {description}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <footer className="border-x border-b border-border/60 px-6 py-6 text-sm text-muted-foreground sm:px-10 lg:px-14">
          © {new Date().getFullYear()} MirrorPilot. Container image mirroring made effortless.
        </footer>
      </div>
    </main>
  )
}
