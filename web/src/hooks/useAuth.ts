import { useEffect, useState } from 'react'

export interface User {
  id: number
  email: string
  name: string
  avatar_url: string
  is_admin: number
  status?: string
}

interface AuthState {
  user: User | null
  loading: boolean
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ user: null, loading: true })

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((data: { user: User | null }) =>
        setState({ user: data.user, loading: false })
      )
      .catch(() => setState({ user: null, loading: false }))
  }, [])

  const login = () => {
    window.location.href = '/api/auth/github'
  }

  const loginWithPassword = async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = (await res.json()) as { error?: string }
    if (!res.ok) {
      throw new Error(data.error || 'Login failed')
    }
    window.location.href = '/images'
  }

  const register = async (email: string, password: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = (await res.json()) as { error?: string; status?: string }
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed')
    }
    return data.status || 'verification_sent'
  }

  const verifyRegistrationCode = async (email: string, code: string) => {
    const res = await fetch('/api/auth/register/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    })
    const data = (await res.json()) as { error?: string; status?: string }
    if (!res.ok) {
      throw new Error(data.error || 'Verification failed')
    }
    if (data.status === 'active') {
      window.location.href = '/images'
    }
    return data.status || 'pending'
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setState({ user: null, loading: false })
    window.location.href = '/'
  }

  return { ...state, login, loginWithPassword, register, verifyRegistrationCode, logout }
}
