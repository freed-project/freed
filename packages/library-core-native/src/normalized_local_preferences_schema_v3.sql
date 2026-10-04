CREATE TABLE library_local_preference_projection (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  actor_id TEXT NOT NULL REFERENCES library_intent_actors(actor_id) ON DELETE CASCADE,
  last_counter INTEGER NOT NULL CHECK (last_counter BETWEEN 0 AND 9007199254740991),
  target_counter INTEGER NOT NULL CHECK (target_counter BETWEEN last_counter AND 9007199254740991),
  previous_operation_id TEXT CHECK (previous_operation_id IS NULL OR length(CAST(previous_operation_id AS BLOB)) BETWEEN 1 AND 255),
  previous_chain_digest TEXT NOT NULL CHECK (length(previous_chain_digest) = 64 AND previous_chain_digest NOT GLOB '*[^0-9a-f]*'),
  CHECK ((last_counter = 0 AND previous_operation_id IS NULL) OR (last_counter > 0 AND previous_operation_id IS NOT NULL))
) STRICT;

CREATE TABLE library_local_preference_nodes (
  transaction_id TEXT NOT NULL,
  member_index INTEGER NOT NULL CHECK (member_index BETWEEN 0 AND 999),
  actor_id TEXT NOT NULL,
  actor_counter INTEGER NOT NULL CHECK (actor_counter BETWEEN 1 AND 9007199254740991),
  path TEXT NOT NULL CHECK (length(CAST(path AS BLOB)) BETWEEN 2 AND 4094 AND substr(path, 1, 2) = '$.'),
  node_kind TEXT NOT NULL CHECK (node_kind IN ('object', 'array', 'value')),
  value_type TEXT NOT NULL CHECK (value_type IN ('boolean', 'integer', 'real', 'text', 'null')),
  boolean_value INTEGER CHECK (boolean_value IS NULL OR boolean_value IN (0, 1)),
  integer_value INTEGER CHECK (integer_value IS NULL OR integer_value BETWEEN -9007199254740991 AND 9007199254740991),
  real_value REAL CHECK (real_value IS NULL OR (real_value > -1e999 AND real_value < 1e999)),
  text_value TEXT CHECK (text_value IS NULL OR length(CAST(text_value AS BLOB)) <= 8192),
  updated_at INTEGER NOT NULL CHECK (updated_at BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (transaction_id, member_index, path),
  FOREIGN KEY (transaction_id, member_index) REFERENCES library_intent_members(transaction_id, member_index) ON DELETE CASCADE,
  FOREIGN KEY (actor_id, actor_counter) REFERENCES library_intent_members(actor_id, actor_counter) ON DELETE CASCADE,
  CHECK (
    (value_type = 'boolean' AND boolean_value IS NOT NULL AND integer_value IS NULL AND real_value IS NULL AND text_value IS NULL)
    OR (value_type = 'integer' AND boolean_value IS NULL AND integer_value IS NOT NULL AND real_value IS NULL AND text_value IS NULL)
    OR (value_type = 'real' AND boolean_value IS NULL AND integer_value IS NULL AND real_value IS NOT NULL AND text_value IS NULL)
    OR (value_type = 'text' AND boolean_value IS NULL AND integer_value IS NULL AND real_value IS NULL AND text_value IS NOT NULL)
    OR (value_type = 'null' AND boolean_value IS NULL AND integer_value IS NULL AND real_value IS NULL AND text_value IS NULL)
  ),
  CHECK ((node_kind = 'object' AND value_type = 'null') OR (node_kind = 'array' AND value_type = 'integer' AND integer_value BETWEEN 0 AND 511) OR node_kind = 'value')
) STRICT, WITHOUT ROWID;

CREATE INDEX library_local_preference_node_lookup
  ON library_local_preference_nodes(actor_id, path, actor_counter DESC);

CREATE INDEX library_local_preference_replacement_lookup
  ON library_local_preference_nodes(actor_id, path, actor_counter DESC)
  WHERE node_kind <> 'object';
