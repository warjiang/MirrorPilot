export interface Env {
  DB: D1Database
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  GITHUB_TOKEN: string
  GITHUB_REPO: string
  SYNC_SECRET: string
  RESEND_API_KEY: string
  EMAIL_FROM_ADDRESS: string
  EMAIL_FROM_NAME?: string
  DEV_USER_EMAIL?: string
  ADMIN_EMAIL?: string
}
