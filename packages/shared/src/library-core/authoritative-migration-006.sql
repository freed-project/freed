-- Schema 6: bounded per-source paging for the active Desktop Library.
--
-- Friends and RSS surfaces query one author or feed at a time. The generic
-- timeline indexes forced each source query to walk the complete Library
-- before it could return a handful of rows. Keep source equality in the query
-- plan and index the exact timeline order used by those bounded pages.

CREATE INDEX library_core_feed_items_all_author_timeline
  ON library_core_feed_items (
    platform, authorId, publishedAt DESC, capturedAt DESC, globalId ASC
  )
  WHERE deletedAt IS NULL;

CREATE INDEX library_core_feed_items_visible_author_timeline
  ON library_core_feed_items (
    platform, authorId, publishedAt DESC, capturedAt DESC, globalId ASC
  )
  WHERE deletedAt IS NULL AND hidden IS NOT 1;

CREATE INDEX library_core_feed_items_all_feed_timeline
  ON library_core_feed_items (
    platform, feedUrl, publishedAt DESC, capturedAt DESC, globalId ASC
  )
  WHERE deletedAt IS NULL;

CREATE INDEX library_core_feed_items_visible_feed_timeline
  ON library_core_feed_items (
    platform, feedUrl, publishedAt DESC, capturedAt DESC, globalId ASC
  )
  WHERE deletedAt IS NULL AND hidden IS NOT 1;

PRAGMA user_version = 6;
