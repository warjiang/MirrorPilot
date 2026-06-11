CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending',
  github_run_id INTEGER,
  image_total   INTEGER NOT NULL DEFAULT 0,
  image_success INTEGER NOT NULL DEFAULT 0,
  image_failed  INTEGER NOT NULL DEFAULT 0,
  error         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  started_at    TEXT,
  finished_at   TEXT
);

CREATE TABLE IF NOT EXISTS job_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  image_id    INTEGER NOT NULL,
  source      TEXT NOT NULL,
  target      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  error       TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_items_job ON job_items(job_id);
