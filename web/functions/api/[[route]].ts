import { handle } from 'hono/cloudflare-pages'
import { app } from '../_server/app'

export const onRequest = handle(app)
