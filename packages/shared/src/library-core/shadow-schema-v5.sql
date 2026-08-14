ALTER TABLE feed_items
  ADD COLUMN hasLocation INTEGER NOT NULL DEFAULT 0;

UPDATE feed_items
SET hasLocation = CASE
  WHEN json_type(rest, '$.location') = 'object'
    OR json_extract(contentBlob, '$.text') GLOB '*📍*'
    OR json_extract(contentBlob, '$.text') GLOB '*🌍*'
    OR json_extract(contentBlob, '$.text') GLOB '*🌎*'
    OR json_extract(contentBlob, '$.text') GLOB '*🌏*'
    OR json_extract(contentBlob, '$.text') GLOB 'in [A-Z]*'
    OR json_extract(contentBlob, '$.text') GLOB 'at [A-Z]*'
    OR json_extract(contentBlob, '$.text') GLOB 'from [A-Z]*'
    OR json_extract(contentBlob, '$.text') GLOB '* in [A-Z]*'
    OR json_extract(contentBlob, '$.text') GLOB '* at [A-Z]*'
    OR json_extract(contentBlob, '$.text') GLOB '* from [A-Z]*'
  THEN 1
  ELSE 0
END;

CREATE INDEX feed_items_map_timeline
  ON feed_items (sortAt DESC, globalId ASC)
  WHERE hasLocation = 1;

PRAGMA user_version = 5;
