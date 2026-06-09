import { useEffect, useState } from 'react'

export interface User {
  id: number
  email: string
  name: string
  avatar_url: string
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

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setState({ user: null, loading: false })
    window.location.href = '/'
  }

  return { ...state, login, logout }
}
