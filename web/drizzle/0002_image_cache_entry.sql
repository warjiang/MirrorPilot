ALTER TABLE `images` ADD COLUMN `is_cache_entry` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_images_cache` ON `images` (`user_id`, `profile`, `source`, `is_cache_entry`);
