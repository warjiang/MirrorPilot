import { useState, type FormEvent } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'

type Mode = 'login' | 'register'

export function EmailAuthCard() {
  const { loginWithPassword, register } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('auth_error') === 'disabled'
      ? 'Your account has been disabled. Contact an administrator.'
      : null
  })
  const [notice, setNotice] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('auth_error') === 'pending'
      ? 'Your account is pending admin approval. Please try again later.'
      : null
  })
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      if (mode === 'login') {
        await loginWithPassword(email, password)
      } else {
        const status = await register(email, password)
        if (status === 'active') {
          setNotice('Registration complete. You can now sign in.')
        } else {
          setNotice('Registration submitted. An admin must approve your account before you can sign in.')
        }
        setMode('login')
        setPassword('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="auth-email">Email</Label>
        <Input
          id="auth-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="auth-password">Password</Label>
        <Input
          id="auth-password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
        />
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      {notice && (
        <p className="text-sm text-muted-foreground">{notice}</p>
      )}

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            {mode === 'login' ? 'Sign in' : 'Create account'}
            <ArrowRight className="size-4" />
          </>
        )}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {mode === 'login' ? (
          <>
            No account?{' '}
            <button
              type="button"
              className="font-medium text-foreground underline-offset-4 hover:underline"
              onClick={() => {
                setMode('register')
                setError(null)
                setNotice(null)
              }}
            >
              Register
            </button>
          </>
        ) : (
          <>
            Already registered?{' '}
            <button
              type="button"
              className="font-medium text-foreground underline-offset-4 hover:underline"
              onClick={() => {
                setMode('login')
                setError(null)
                setNotice(null)
              }}
            >
              Sign in
            </button>
          </>
        )}
      </p>
    </form>
  )
}
