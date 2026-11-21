-- Tokens are stored only as SHA-256 hashes. There is one owner, with independent devices.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  credential_fingerprint TEXT NOT NULL,
  previous_token_hash TEXT,
  previous_valid_until INTEGER,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  rotated_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry_idx ON sessions(idle_expires_at);

-- Hash of a rate-limit bucket; never a raw IP address or owner access key.
CREATE TABLE login_attempts (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK(attempts > 0),
  reset_at INTEGER NOT NULL
);
CREATE INDEX login_attempts_expiry_idx ON login_attempts(reset_at);
