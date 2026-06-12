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
    updatedAt: text('updated_at')
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
    name: text('name').notNull(),
    registry: text('registry').notNull().default(''),
    namespace: text('namespace').notNull().default(''),
    authType: text('auth_type').notNull().default('basic'),
    username: text('username').notNull().default(''),
    passwordSecret: text('password_secret').notNull().default(''),
    isActive: integer('is_active').notNull().default(1),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('profiles_name_unique').on(t.name),
    index('idx_profiles_active').on(t.isActive),
  ]
)

export const images = sqliteTable(
  'images',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    source: text('source').notNull(),
    target: text('default_target').notNull(),
    isActive: integer('is_active').notNull().default(1),
    notes: text('notes').notNull().default(''),
    lastSyncStatus: text('last_sync_status').notNull().default('pending'),
    lastSyncAt: text('last_sync_at'),
    lastError: text('last_error').notNull().default(''),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_images_source').on(t.source),
    index('idx_images_active').on(t.isActive),
    index('idx_images_sync_status').on(t.lastSyncStatus),
  ]
)

export const userProfiles = sqliteTable(
  'user_profiles',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    profileId: integer('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    enabled: integer('enabled').notNull().default(1),
    grantedBy: integer('granted_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('user_profiles_user_id_profile_id_unique').on(t.userId, t.profileId),
    index('idx_user_profiles_user').on(t.userId, t.enabled),
    index('idx_user_profiles_profile').on(t.profileId),
  ]
)

export const userImages = sqliteTable(
  'user_images',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    imageId: integer('image_id')
      .notNull()
      .references(() => images.id, { onDelete: 'cascade' }),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    uniqueIndex('user_images_user_id_image_id_unique').on(t.userId, t.imageId),
    index('idx_user_images_user').on(t.userId, t.deletedAt),
  ]
)

export const imageProfiles = sqliteTable(
  'image_profiles',
  {
    imageId: integer('image_id')
      .notNull()
      .references(() => images.id, { onDelete: 'cascade' }),
    profileId: integer('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    enabled: integer('enabled').notNull().default(1),
    priority: integer('priority').notNull().default(100),
    isDefault: integer('is_default').notNull().default(0),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('image_profiles_image_id_profile_id_unique').on(t.imageId, t.profileId),
    index('idx_image_profiles_image_enabled_priority').on(t.imageId, t.enabled, t.priority),
    index('idx_image_profiles_profile').on(t.profileId),
  ]
)

export const jobs = sqliteTable(
  'sync_jobs',
  {
    id: text('id').primaryKey(),
    userId: integer('trigger_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    githubRunId: integer('github_run_id'),
    requestId: text('request_id').notNull().default(''),
    imageTotal: integer('image_total').notNull().default(0),
    imageSuccess: integer('image_success').notNull().default(0),
    imageFailed: integer('image_failed').notNull().default(0),
    error: text('error_summary').notNull().default(''),
    createdAt: text('triggered_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (t) => [
    index('idx_sync_jobs_user_triggered').on(t.userId, t.createdAt),
    index('idx_sync_jobs_status').on(t.status),
  ]
)

export const jobItems = sqliteTable(
  'sync_job_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    imageId: integer('image_id')
      .notNull()
      .references(() => images.id, { onDelete: 'cascade' }),
    profileId: integer('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    target: text('target').notNull(),
    status: text('status').notNull().default('pending'),
    error: text('error').notNull().default(''),
    durationMs: integer('duration_ms'),
    finishedAt: text('finished_at'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_sync_job_items_job_status').on(t.jobId, t.status),
    index('idx_sync_job_items_user').on(t.userId),
    index('idx_sync_job_items_image').on(t.imageId),
  ]
)

export const syncJobEvents = sqliteTable(
  'sync_job_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    jobItemId: integer('job_item_id').references(() => jobItems.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    eventSource: text('event_source').notNull().default('manual'),
    payloadJson: text('payload_json').notNull().default('{}'),
    httpStatus: integer('http_status'),
    message: text('message').notNull().default(''),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_sync_job_events_job_created').on(t.jobId, t.createdAt),
    index('idx_sync_job_events_item_created').on(t.jobItemId, t.createdAt),
  ]
)
