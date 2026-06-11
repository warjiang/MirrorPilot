import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'
import {
  getOrCreateUserByEmail,
  getSessionId,
  getSessionUser,
  renewSession,
} from '../lib/session'

/**
 * Resolves the authenticated user and stores it in context.
 * Order: valid session cookie > DEV_USER_EMAIL bypass > Cf-Access header.
 */
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const db = c.get('db')

  const sessionId = getSessionId(c.req.raw)
  if (sessionId) {
    const user = await getSessionUser(db, sessionId)
    if (user) {
      if (user.status !== 'active') {
        return c.json({ error: 'Forbidden' }, 403)
      }
      await renewSession(db, sessionId)
      c.set('user', user)
      return next()
    }
  }

  const devEmail = c.env.DEV_USER_EMAIL?.toLowerCase().trim()
  if (devEmail) {
    const user = await getOrCreateUserByEmail(db, devEmail)
    c.set('user', user)
    return next()
  }

  const accessEmail = c.req.header('Cf-Access-Authenticated-User-Email')
  if (accessEmail) {
    const user = await getOrCreateUserByEmail(db, accessEmail.toLowerCase().trim())
    c.set('user', user)
    return next()
  }

  return c.json({ error: 'Unauthorized' }, 401)
})

export const adminMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user')
  if (!user || user.isAdmin !== 1) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  return next()
})
