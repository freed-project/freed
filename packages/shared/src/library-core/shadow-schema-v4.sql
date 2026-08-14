CREATE INDEX IF NOT EXISTS feed_items_friends_timeline
  ON feed_items (sortAt DESC, globalId ASC)
  WHERE hidden IS NOT 1;

PRAGMA user_version = 4;
