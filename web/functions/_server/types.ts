import type { Env } from './env'
import type { Db } from './db'

export interface AuthUser {
  id: number
  email: string
  name: string
  avatarUrl: string
  isAdmin: number
  status: string
}

export type AppEnv = {
  Bindings: Env
  Variables: {
    db: Db
    user: AuthUser
  }
}
