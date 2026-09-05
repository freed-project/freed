# Selected Person or Account detail, timelines, and contact matching

`person_detail_v1` is the normalized point query for one visible Person and
the linked Account window needed to render that selected Friend. It returns
one closed Person row, the total linked Account count, and at most 64 closed
linked Account rows in SQLite binary ID order. Tags are capped at 64 in SQLite
binary order. Reach-out history is capped at the latest 20 events in
descending time order with accepted operation IDs as the stable tie-break
identity. The source-fenced response is capped at 2 MiB. A total count larger
than the returned Account window fails the complete Friend transform closed.
Timeline cards use their own bounded page queries, so opening one Person never
hydrates the Friends graph, a complete Account catalog, or a hidden Library
shell.

`person_timeline_v1` pages compact feed cards for one Person directly from the
derived `library_person_feed_items` relation. FeedItem and Account mutations
maintain that relation inside the same SQLite transaction. Its primary key is
`(person_id, published_at DESC, global_id)`, so native SQLite and browser
SQLite read no more than 101 timeline rows for a 100-row response. The request
names one Person ID, not a renderer-built list of account keys. The opaque
cursor binds the Person identity digest, database generation, source revision,
publication time, and final item ID. It cannot be resumed for another Person
or another materialization. Hidden and archived items remain indexed but are
excluded by the query, which keeps visibility changes cheap and deterministic.
Freed Desktop and the PWA invoke this query through one shared adapter. The
selected view passes only the stable Person ID, limit, and opaque cursor. The
Desktop host supplies the native executor and the PWA supplies the OPFS SQLite
worker executor. Neither host enumerates account keys or consults its
historical item store.

`account_timeline_v1` provides the same bounded card and cursor contract for
one Account that is not linked to a Person. SQLite joins the Account's typed
provider and external identity to visible FeedItems. The request names only
the stable Account ID. Its opaque cursor binds that Account, the database
generation, the source revision, the publication time, and the final item ID.
Linked Accounts continue through `person_timeline_v1`, so a Person timeline
combines all linked sources while an unlinked Account never impersonates a
Person. Freed Desktop and the PWA choose between these two typed queries at the
selected-detail boundary. React never constructs provider keys or filters a
FeedItem corpus.

`account_detail_v1` is the matching normalized point query for one visible
Account. It reads one Account primary key, returns at most eight follow-roster
roles in SQLite binary order, and carries no Person, FeedItem, or graph corpus.
The source-fenced response is capped at 512 KiB. Missing Accounts return a
typed null result rather than causing a whole-library fallback.

The Friends selection boundary uses `person_detail_v1` and
`account_detail_v1` directly. Freed Desktop supplies the native executor and
the PWA supplies the OPFS SQLite worker executor to one shared typed reader.
React retains only the selected Friend with its bounded linked Account window,
or one selected unlinked Account. A missing row clears that selection after a
successful source-fenced read. A failed or incomplete read does not consult a
renderer identity dictionary.

`contact_match_v1` resolves one Google Contact against trigger-maintained
normalized identity keys in SQLite. The closed request accepts at most eight
sorted normalized names and 16 sorted normalized email addresses. The
source-fenced response returns at most one Person ID and 32 unlinked social
Account IDs under a 128 KiB ceiling. Person names, contact Account emails,
social display names, and normalized social handles enter indexed match-key
tables in the same SQLite transaction as their Person or Account write.
Native Rust and browser SQLite execute the same generated SQL. React never
subscribes to Person or Account dictionaries, scans FeedItems, reconstructs
Accounts from authors, or sorts a candidate corpus. Linking a suggestion
creates only the typed Google contact Account and applies registered Account
to Person assignments to the returned existing Account IDs.
