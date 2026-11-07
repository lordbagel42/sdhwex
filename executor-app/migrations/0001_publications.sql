CREATE TABLE publications (
  id TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL,
  action TEXT NOT NULL,
  before_hash TEXT NOT NULL,
  after_hash TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  detail TEXT
);
CREATE TABLE publish_lock (
  slot INTEGER PRIMARY KEY CHECK (slot = 1),
  operation_id TEXT,
  started_at INTEGER
);
INSERT INTO publish_lock (slot, operation_id) VALUES (1, NULL);
