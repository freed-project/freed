-- Schema 5: bounded timeline paging for the active Desktop Library.
--
-- The renderer and compatibility readers page through the full Library in
-- timeline order. The original index excluded archived rows, while the query
-- intentionally includes them unless the caller asks otherwise. SQLite then
-- scanned the feed index and rebuilt the complete sort for every OFFSET page.

CREATE INDEX library_core_feed_items_all_timeline
  ON library_core_feed_items (publishedAt DESC, capturedAt DESC, globalId ASC)
  WHERE deletedAt IS NULL;

CREATE INDEX library_core_feed_items_visible_timeline
  ON library_core_feed_items (publishedAt DESC, capturedAt DESC, globalId ASC)
  WHERE deletedAt IS NULL AND hidden IS NOT 1;

PRAGMA user_version = 5;
