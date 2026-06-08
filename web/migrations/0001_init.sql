CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL UNIQUE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  registry     TEXT    NOT NULL DEFAULT '',
  username_env TEXT    NOT NULL DEFAULT '',
  password_env TEXT    NOT NULL DEFAULT '',
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source     TEXT    NOT NULL,
  target     TEXT    NOT NULL,
  profile    TEXT    NOT NULL DEFAULT 'default',
  enabled    INTEGER NOT NULL DEFAULT 1,
  synced     INTEGER NOT NULL DEFAULT 0,
  notes      TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  synced_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_images_user   ON images(user_id);
