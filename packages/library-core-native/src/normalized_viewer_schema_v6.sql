CREATE TABLE library_local_viewer_policy (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  library_id TEXT NOT NULL CHECK (length(library_id) = 64 AND library_id NOT GLOB '*[^0-9a-f]*'),
  source_handoff_id TEXT NOT NULL CHECK (length(source_handoff_id) = 64 AND source_handoff_id NOT GLOB '*[^0-9a-f]*'),
  enabled_at INTEGER NOT NULL CHECK (enabled_at BETWEEN 0 AND 9007199254740991)
) STRICT;
