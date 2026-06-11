import { useState, type FormEvent } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'

type Mode = 'login' | 'register' | 'verify'

export function EmailAuthCard() {
  const { loginWithPassword, register, verifyRegistrationCode } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
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

  const sendCode = async () => {
    const status = await register(email, password)
    setNotice(`We sent a verification code to ${email}.`)
    setVerificationCode('')
    setMode('verify')
    return status
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      if (mode === 'login') {
        await loginWithPassword(email, password)
        return
      }

      if (mode === 'register') {
        await sendCode()
        return
      }

      const status = await verifyRegistrationCode(email, verificationCode)
      if (status === 'pending') {
        setNotice('Email verified. Your account is waiting for admin approval.')
        setMode('login')
        setPassword('')
        setVerificationCode('')
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
          disabled={mode === 'verify'}
        />
      </div>

      {mode !== 'verify' && (
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
      )}

      {mode === 'verify' && (
        <div className="space-y-1.5">
          <Label htmlFor="auth-code">Verification code</Label>
          <Input
            id="auth-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
          />
          <p className="text-xs text-muted-foreground">We sent the code to {email}.</p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            {mode === 'login'
              ? 'Sign in'
              : mode === 'register'
                ? 'Send verification code'
                : 'Verify code'}
            <ArrowRight className="size-4" />
          </>
        )}
      </Button>

      {mode === 'verify' && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={submitting}
          onClick={async () => {
            setError(null)
            setNotice(null)
            setSubmitting(true)
            try {
              await sendCode()
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Something went wrong')
            } finally {
              setSubmitting(false)
            }
          }}
        >
          Resend code
        </Button>
      )}

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
        ) : mode === 'register' ? (
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
        ) : (
          <>
            Need to change email or password?{' '}
            <button
              type="button"
              className="font-medium text-foreground underline-offset-4 hover:underline"
              onClick={() => {
                setMode('register')
                setError(null)
                setNotice(null)
              }}
            >
              Go back
            </button>
          </>
        )}
      </p>
    </form>
  )
}
