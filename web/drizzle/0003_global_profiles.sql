PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`registry` text DEFAULT '' NOT NULL,
	`username_env` text DEFAULT '' NOT NULL,
	`password_env` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_profiles`("id", "name", "registry", "username_env", "password_env")
SELECT "id", "name", "registry", "username_env", "password_env" FROM `profiles` p
WHERE p."id" = (
	SELECT p2."id" FROM `profiles` p2
	WHERE p2."name" = p."name"
	ORDER BY (p2."registry" != '' AND p2."username_env" != '' AND p2."password_env" != '') DESC,
		(p2."registry" != '') DESC,
		p2."id" ASC
	LIMIT 1
);--> statement-breakpoint
DROP TABLE `profiles`;--> statement-breakpoint
ALTER TABLE `__new_profiles` RENAME TO `profiles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_name_unique` ON `profiles` (`name`);
