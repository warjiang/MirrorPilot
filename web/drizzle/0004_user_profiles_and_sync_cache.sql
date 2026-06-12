PRAGMA foreign_keys=OFF;--> statement-breakpoint

CREATE TABLE `__new_profiles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `name` text NOT NULL,
  `registry` text DEFAULT '' NOT NULL,
  `username_env` text DEFAULT '' NOT NULL,
  `password_env` text DEFAULT '' NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

INSERT INTO `__new_profiles` (`user_id`, `name`, `registry`, `username_env`, `password_env`)
SELECT
  u.`id` AS `user_id`,
  p.`name`,
  p.`registry`,
  p.`username_env`,
  p.`password_env`
FROM `users` u
INNER JOIN `profiles` p
  ON p.`name` IN (
    SELECT DISTINCT i.`profile`
    FROM `images` i
    WHERE i.`user_id` = u.`id` AND COALESCE(i.`is_cache_entry`, 0) = 0
  );--> statement-breakpoint

INSERT INTO `__new_profiles` (`user_id`, `name`, `registry`, `username_env`, `password_env`)
SELECT
  u.`id`,
  'default',
  '',
  '',
  ''
FROM `users` u
WHERE NOT EXISTS (
  SELECT 1 FROM `__new_profiles` p WHERE p.`user_id` = u.`id`
);--> statement-breakpoint

DROP TABLE `profiles`;--> statement-breakpoint
ALTER TABLE `__new_profiles` RENAME TO `profiles`;--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_user_id_name_unique` ON `profiles` (`user_id`, `name`);--> statement-breakpoint
CREATE INDEX `idx_profiles_user` ON `profiles` (`user_id`);--> statement-breakpoint

CREATE TABLE `image_sync_cache` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `profile` text NOT NULL,
  `source` text NOT NULL,
  `target` text NOT NULL,
  `synced_at` text DEFAULT (datetime('now')) NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `image_sync_cache_user_profile_source_unique` ON `image_sync_cache` (`user_id`, `profile`, `source`);--> statement-breakpoint
CREATE INDEX `idx_image_sync_cache_user` ON `image_sync_cache` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_image_sync_cache_profile` ON `image_sync_cache` (`user_id`, `profile`);--> statement-breakpoint

INSERT INTO `image_sync_cache` (`user_id`, `profile`, `source`, `target`, `synced_at`, `created_at`, `updated_at`)
SELECT
  i.`user_id`,
  i.`profile`,
  i.`source`,
  i.`target`,
  COALESCE(i.`synced_at`, datetime('now')),
  COALESCE(i.`created_at`, datetime('now')),
  datetime('now')
FROM `images` i
WHERE COALESCE(i.`is_cache_entry`, 0) = 1 AND i.`status` = 'synced'
ON CONFLICT(`user_id`, `profile`, `source`) DO UPDATE SET
  `target` = excluded.`target`,
  `synced_at` = excluded.`synced_at`,
  `updated_at` = datetime('now');--> statement-breakpoint

CREATE TABLE `__new_images` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `source` text NOT NULL,
  `target` text NOT NULL,
  `profile` text DEFAULT 'default' NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `pinned` integer DEFAULT 0 NOT NULL,
  `synced` integer DEFAULT 0 NOT NULL,
  `notes` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `synced_at` text,
  `status` text DEFAULT 'pending' NOT NULL,
  `sync_error` text DEFAULT '' NOT NULL,
  `sync_run_id` text DEFAULT '' NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

INSERT INTO `__new_images` (
  `id`, `user_id`, `source`, `target`, `profile`, `enabled`, `pinned`, `synced`, `notes`, `created_at`, `synced_at`, `status`, `sync_error`, `sync_run_id`
)
SELECT
  `id`, `user_id`, `source`, `target`, `profile`, `enabled`, `pinned`, `synced`, `notes`, `created_at`, `synced_at`, `status`, `sync_error`, `sync_run_id`
FROM `images`
WHERE COALESCE(`is_cache_entry`, 0) = 0;--> statement-breakpoint

DROP TABLE `images`;--> statement-breakpoint
ALTER TABLE `__new_images` RENAME TO `images`;--> statement-breakpoint
CREATE INDEX `idx_images_user` ON `images` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_images_user_status` ON `images` (`user_id`, `status`, `enabled`);--> statement-breakpoint
CREATE INDEX `idx_images_user_profile` ON `images` (`user_id`, `profile`);--> statement-breakpoint

PRAGMA foreign_keys=ON;
