CREATE TABLE boxes (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX boxes_expires_at ON boxes (expires_at);
