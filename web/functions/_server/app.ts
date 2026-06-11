import { Hono } from 'hono'
import type { AppEnv } from './types'
import { createDb } from './db'
import { adminMiddleware, authMiddleware } from './middleware/auth'
import { authRoutes } from './routes/auth'
import { adminRoutes } from './routes/admin'
import { mirrorsRoutes, getConfigHandler, putConfigHandler } from './routes/mirrors'
import { secretsRoutes } from './routes/secrets'
import { ciSecretsRoutes, syncRoutes } from './routes/sync'
import { checkRegistryRoutes, detectRoutes } from './routes/registry-tools'

export const app = new Hono<AppEnv>().basePath('/api')

app.use('*', async (c, next) => {
  c.set('db', createDb(c.env.DB))
  await next()
})

// Session auth (with DEV_USER_EMAIL / Cf-Access bypass). Exempt: /api/auth/*,
// /api/sync/pending + /api/sync/complete and /api/secrets/ci (SYNC_SECRET auth).
app.use('/config', authMiddleware)
app.use('/mirrors', authMiddleware)
app.use('/mirrors/*', authMiddleware)
app.use('/secrets/registry', authMiddleware)
app.use('/admin/*', authMiddleware, adminMiddleware)
app.use('/detect', authMiddleware)
app.use('/check-registry', authMiddleware)

app.route('/auth', authRoutes)
app.route('/admin', adminRoutes)
app.route('/mirrors', mirrorsRoutes)
app.get('/config', getConfigHandler)
app.put('/config', putConfigHandler)
app.route('/secrets/ci', ciSecretsRoutes)
app.route('/secrets', secretsRoutes)
app.route('/sync', syncRoutes)
app.route('/detect', detectRoutes)
app.route('/check-registry', checkRegistryRoutes)
