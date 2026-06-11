CREATE TABLE `registration_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`password_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registration_codes_email_unique` ON `registration_codes` (`email`);--> statement-breakpoint
CREATE INDEX `idx_registration_codes_expires` ON `registration_codes` (`expires_at`);