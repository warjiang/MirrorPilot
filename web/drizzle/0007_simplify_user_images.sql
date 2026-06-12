-- Migration: Simplify user_images to pure association table
-- Move sync status fields to images table; remove unused columns from user_images

-- Step 1: Add sync fields to images table
ALTER TABLE images ADD COLUMN last_sync_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE images ADD COLUMN last_sync_at TEXT;
ALTER TABLE images ADD COLUMN last_error TEXT NOT NULL DEFAULT '';

-- Step 2: Migrate sync data from user_images to images
-- For each image, pick the "best" sync status from any user_images row
-- Priority: synced > syncing > failed > pending
UPDATE images SET
  last_sync_status = COALESCE(
    (SELECT ui.last_sync_status FROM user_images ui
     WHERE ui.image_id = images.id AND ui.last_sync_status = 'synced' LIMIT 1),
    (SELECT ui.last_sync_status FROM user_images ui
     WHERE ui.image_id = images.id AND ui.last_sync_status = 'syncing' LIMIT 1),
    (SELECT ui.last_sync_status FROM user_images ui
     WHERE ui.image_id = images.id AND ui.last_sync_status = 'failed' LIMIT 1),
    'pending'
  ),
  last_sync_at = (SELECT ui.last_sync_at FROM user_images ui
    WHERE ui.image_id = images.id AND ui.last_sync_at IS NOT NULL
    ORDER BY ui.last_sync_at DESC LIMIT 1),
  last_error = COALESCE(
    (SELECT ui.last_error FROM user_images ui
     WHERE ui.image_id = images.id AND ui.last_error != ''
     ORDER BY ui.last_sync_at DESC LIMIT 1),
    ''
  );

-- Step 3: Recreate user_images as a simple association table
-- SQLite does not support DROP COLUMN, so we recreate the table
CREATE TABLE user_images_new (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

INSERT INTO user_images_new (user_id, image_id, created_at, deleted_at)
SELECT user_id, image_id, created_at, NULL
FROM user_images
WHERE enabled = 1;

DROP TABLE user_images;
ALTER TABLE user_images_new RENAME TO user_images;

-- Step 4: Recreate indexes
CREATE UNIQUE INDEX user_images_user_id_image_id_unique ON user_images(user_id, image_id);
CREATE INDEX idx_user_images_user ON user_images(user_id, deleted_at);

-- Step 5: Add index for sync status on images
CREATE INDEX idx_images_sync_status ON images(last_sync_status);
