CREATE TABLE IF NOT EXISTS subscribers (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  email    TEXT    NOT NULL,
  source   TEXT    NOT NULL DEFAULT 'newsletter',
  created_at TEXT  NOT NULL DEFAULT (datetime('now')),
  UNIQUE(email, source)
);
