import { Hono } from 'hono'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { AppEnv } from '../types'
import { registrySecrets } from '../db/schema'

export const secretsRoutes = new Hono<AppEnv>()

secretsRoutes.get('/registry', async (c) => {
  const db = c.get('db')
  const userId = c.get('user').id

  const rows = await db
    .select({
      registry: registrySecrets.registry,
      destUser: registrySecrets.destUser,
    })
    .from(registrySecrets)
    .where(eq(registrySecrets.userId, userId))
    .orderBy(asc(registrySecrets.registry))

  const secrets = rows.map((row) => ({
    registry: row.registry,
    destUser: row.destUser,
    // Don't return the password
    destPass: '***',
  }))

  return c.json({ secrets })
})

secretsRoutes.post('/registry', async (c) => {
  const db = c.get('db')
  const userId = c.get('user').id

  let body: { registry?: string; destUser?: string; destPass?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400)
  }

  if (!body.registry || !body.destUser || !body.destPass) {
    return c.json({ error: 'registry, destUser, and destPass are required' }, 400)
  }

  // Validate registry format (should be a valid registry URL)
  try {
    new URL(`https://${body.registry}`)
  } catch {
    return c.json({ error: 'invalid registry format' }, 400)
  }

  await db
    .insert(registrySecrets)
    .values({
      userId,
      registry: body.registry,
      destUser: body.destUser,
      destPass: body.destPass,
    })
    .onConflictDoUpdate({
      target: [registrySecrets.userId, registrySecrets.registry],
      set: {
        destUser: body.destUser,
        destPass: body.destPass,
        updatedAt: sql`datetime('now')`,
      },
    })

  return c.json({ ok: true })
})

secretsRoutes.delete('/registry', async (c) => {
  const db = c.get('db')
  const userId = c.get('user').id

  const registry = c.req.query('registry')
  if (!registry) {
    return c.json({ error: 'registry query parameter is required' }, 400)
  }

  await db
    .delete(registrySecrets)
    .where(and(eq(registrySecrets.userId, userId), eq(registrySecrets.registry, registry)))

  return c.json({ ok: true })
})
