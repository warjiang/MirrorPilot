PRAGMA foreign_keys = OFF;

ALTER TABLE `users` ADD COLUMN `updated_at` text NOT NULL DEFAULT '';
UPDATE `users` SET `updated_at` = datetime('now') WHERE `updated_at` = '';

DROP TABLE IF EXISTS `sync_job_events`;
DROP TABLE IF EXISTS `sync_job_items`;
DROP TABLE IF EXISTS `sync_jobs`;
DROP TABLE IF EXISTS `image_profiles`;
DROP TABLE IF EXISTS `user_images`;
DROP TABLE IF EXISTS `user_profiles`;

DROP TABLE IF EXISTS `image_sync_cache`;
DROP TABLE IF EXISTS `registry_secrets`;
DROP TABLE IF EXISTS `job_items`;
DROP TABLE IF EXISTS `jobs`;
DROP TABLE IF EXISTS `images`;
DROP TABLE IF EXISTS `profiles`;

CREATE TABLE `profiles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `registry` text NOT NULL DEFAULT '',
  `auth_type` text NOT NULL DEFAULT 'basic',
  `username` text NOT NULL DEFAULT '',
  `password_secret` text NOT NULL DEFAULT '',
  `is_active` integer NOT NULL DEFAULT 1,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX `profiles_name_unique` ON `profiles` (`name`);
CREATE INDEX `idx_profiles_active` ON `profiles` (`is_active`);

CREATE TABLE `images` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `source` text NOT NULL,
  `default_target` text NOT NULL,
  `is_active` integer NOT NULL DEFAULT 1,
  `notes` text NOT NULL DEFAULT '',
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX `idx_images_source` ON `images` (`source`);
CREATE INDEX `idx_images_active` ON `images` (`is_active`);

CREATE TABLE `user_profiles` (
  `user_id` integer NOT NULL,
  `profile_id` integer NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `granted_by` integer,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `user_profiles_user_id_profile_id_unique` ON `user_profiles` (`user_id`, `profile_id`);
CREATE INDEX `idx_user_profiles_user` ON `user_profiles` (`user_id`, `enabled`);
CREATE INDEX `idx_user_profiles_profile` ON `user_profiles` (`profile_id`);

CREATE TABLE `user_images` (
  `user_id` integer NOT NULL,
  `image_id` integer NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `pinned` integer NOT NULL DEFAULT 0,
  `target_override` text,
  `notes` text NOT NULL DEFAULT '',
  `last_sync_status` text NOT NULL DEFAULT 'pending',
  `last_sync_at` text,
  `last_error` text NOT NULL DEFAULT '',
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `user_images_user_id_image_id_unique` ON `user_images` (`user_id`, `image_id`);
CREATE INDEX `idx_user_images_user_enabled_pinned` ON `user_images` (`user_id`, `enabled`, `pinned`);
CREATE INDEX `idx_user_images_last_sync` ON `user_images` (`user_id`, `last_sync_status`);

CREATE TABLE `image_profiles` (
  `image_id` integer NOT NULL,
  `profile_id` integer NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `priority` integer NOT NULL DEFAULT 100,
  `is_default` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `image_profiles_image_id_profile_id_unique` ON `image_profiles` (`image_id`, `profile_id`);
CREATE INDEX `idx_image_profiles_image_enabled_priority` ON `image_profiles` (`image_id`, `enabled`, `priority`);
CREATE INDEX `idx_image_profiles_profile` ON `image_profiles` (`profile_id`);

CREATE TABLE `sync_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `trigger_user_id` integer NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `github_run_id` integer,
  `request_id` text NOT NULL DEFAULT '',
  `image_total` integer NOT NULL DEFAULT 0,
  `image_success` integer NOT NULL DEFAULT 0,
  `image_failed` integer NOT NULL DEFAULT 0,
  `error_summary` text NOT NULL DEFAULT '',
  `triggered_at` text NOT NULL DEFAULT (datetime('now')),
  `started_at` text,
  `finished_at` text,
  FOREIGN KEY (`trigger_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_sync_jobs_user_triggered` ON `sync_jobs` (`trigger_user_id`, `triggered_at`);
CREATE INDEX `idx_sync_jobs_status` ON `sync_jobs` (`status`);

CREATE TABLE `sync_job_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` text NOT NULL,
  `user_id` integer NOT NULL,
  `image_id` integer NOT NULL,
  `profile_id` integer NOT NULL,
  `source` text NOT NULL,
  `target` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `error` text NOT NULL DEFAULT '',
  `duration_ms` integer,
  `finished_at` text,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (`job_id`) REFERENCES `sync_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_sync_job_items_job_status` ON `sync_job_items` (`job_id`, `status`);
CREATE INDEX `idx_sync_job_items_user` ON `sync_job_items` (`user_id`);
CREATE INDEX `idx_sync_job_items_image` ON `sync_job_items` (`image_id`);

CREATE TABLE `sync_job_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` text NOT NULL,
  `job_item_id` integer,
  `event_type` text NOT NULL,
  `event_source` text NOT NULL DEFAULT 'manual',
  `payload_json` text NOT NULL DEFAULT '{}',
  `http_status` integer,
  `message` text NOT NULL DEFAULT '',
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (`job_id`) REFERENCES `sync_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`job_item_id`) REFERENCES `sync_job_items`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `idx_sync_job_events_job_created` ON `sync_job_events` (`job_id`, `created_at`);
CREATE INDEX `idx_sync_job_events_item_created` ON `sync_job_events` (`job_item_id`, `created_at`);

PRAGMA foreign_keys = ON;
