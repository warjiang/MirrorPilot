CREATE TABLE IF NOT EXISTS registry_secrets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registry   TEXT    NOT NULL,
  dest_user  TEXT    NOT NULL,
  dest_pass  TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, registry)
);

CREATE INDEX IF NOT EXISTS idx_registry_secrets_user ON registry_secrets(user_id);
