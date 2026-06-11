import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    email: text('email').notNull().unique(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    githubId: integer('github_id'),
    name: text('name').notNull().default(''),
    avatarUrl: text('avatar_url').notNull().default(''),
    isAdmin: integer('is_admin').notNull().default(0),
    passwordHash: text('password_hash'),
    status: text('status').notNull().default('active'),
  },
  (t) => [
    uniqueIndex('idx_users_github_id').on(t.githubId),
    index('idx_users_admin').on(t.isAdmin),
    index('idx_users_status').on(t.status),
  ]
)

export const registrationCodes = sqliteTable(
  'registration_codes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    passwordHash: text('password_hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('registration_codes_email_unique').on(t.email),
    index('idx_registration_codes_expires').on(t.expiresAt),
  ]
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_sessions_user').on(t.userId),
    index('idx_sessions_expires').on(t.expiresAt),
  ]
)

export const profiles = sqliteTable(
  'profiles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    registry: text('registry').notNull().default(''),
    usernameEnv: text('username_env').notNull().default(''),
    passwordEnv: text('password_env').notNull().default(''),
    credentialRegistry: text('credential_registry').default(''),
  },
  (t) => [
    uniqueIndex('profiles_user_id_name_unique').on(t.userId, t.name),
    index('idx_profiles_user').on(t.userId),
  ]
)

export const images = sqliteTable(
  'images',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    target: text('target').notNull(),
    profile: text('profile').notNull().default('default'),
    enabled: integer('enabled').notNull().default(1),
    pinned: integer('pinned').notNull().default(0),
    synced: integer('synced').notNull().default(0),
    notes: text('notes').notNull().default(''),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    syncedAt: text('synced_at'),
    status: text('status').notNull().default('pending'),
    syncError: text('sync_error').notNull().default(''),
    syncRunId: text('sync_run_id').notNull().default(''),
    isCacheEntry: integer('is_cache_entry').notNull().default(0),
  },
  (t) => [
    index('idx_images_user').on(t.userId),
    index('idx_images_cache').on(t.userId, t.profile, t.source, t.isCacheEntry),
  ]
)

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    githubRunId: integer('github_run_id'),
    imageTotal: integer('image_total').notNull().default(0),
    imageSuccess: integer('image_success').notNull().default(0),
    imageFailed: integer('image_failed').notNull().default(0),
    error: text('error').notNull().default(''),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (t) => [index('idx_jobs_user').on(t.userId, t.createdAt)]
)

export const jobItems = sqliteTable(
  'job_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    imageId: integer('image_id').notNull(),
    source: text('source').notNull(),
    target: text('target').notNull(),
    status: text('status').notNull().default('pending'),
    error: text('error').notNull().default(''),
    durationMs: integer('duration_ms'),
    finishedAt: text('finished_at'),
  },
  (t) => [index('idx_job_items_job').on(t.jobId)]
)

export const registrySecrets = sqliteTable(
  'registry_secrets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    registry: text('registry').notNull(),
    destUser: text('dest_user').notNull(),
    destPass: text('dest_pass').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('registry_secrets_user_id_registry_unique').on(
      t.userId,
      t.registry
    ),
    index('idx_registry_secrets_user').on(t.userId),
  ]
)
