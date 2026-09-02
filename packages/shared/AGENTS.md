# Shared Package Instructions

Read the root `AGENTS.md`. Use `freed-library-core` for any durable library, migration, storage, sync-journal, or Automerge change.

- Keep `shared` pure. It has zero runtime dependencies and no React.
- Schema changes in `src/schema.ts` must be backward compatible. Add optional fields. Never delete a field; mark retired fields `@deprecated`.
- Mutate Automerge documents only through `A.change()`. Direct mutation does not sync.
- Inside `A.change()`, never assign `undefined`; delete the field instead.
- Inside `A.change()`, do not replace an existing nested object. Assign its fields or use the established deep-merge helper.
- Code before the first `await` in an async function runs synchronously. Keep serialization, `A.save()`, large typed-array conversion, and other O(n) work out of fire-and-forget hot paths before the first yield.
- Validate behavior in both browser and Node storage environments when a shared contract reaches both.
