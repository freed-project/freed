SELECT EXISTS (
  SELECT 1 FROM library_intent_transactions AS intent
  JOIN library_meta AS meta ON meta.singleton_id = 1
  WHERE intent.transaction_id = ?1
    AND intent.member_count BETWEEN 1 AND 256
    AND (SELECT count(*) FROM library_intent_members WHERE transaction_id = intent.transaction_id) = intent.member_count
    AND NOT EXISTS (
      SELECT 1 FROM library_intent_members AS member
      WHERE member.transaction_id = intent.transaction_id
        AND (member.actor_id <> intent.actor_id OR member.mutation_id <> 'feed_item_annotations_replace'
          OR member.entity_type <> 'FeedItem' OR member.actor_counter <> intent.first_counter + member.member_index)
    )
    AND (
      EXISTS (
        SELECT 1 FROM library_transactions AS applied
        WHERE applied.transaction_id = intent.transaction_id
          AND applied.transaction_digest = intent.transaction_digest
          AND applied.library_id = meta.library_id
          AND applied.authority_epoch = intent.intent_epoch_id
          AND applied.actor_id = intent.actor_id AND applied.member_count = intent.member_count
          AND applied.first_counter = intent.first_counter AND applied.last_counter = intent.last_counter
          AND NOT EXISTS (
            SELECT 1 FROM library_intent_members AS local
            LEFT JOIN library_operations AS operation
              ON operation.transaction_id = local.transaction_id AND operation.member_index = local.member_index
            WHERE local.transaction_id = intent.transaction_id
              AND (operation.operation_id IS NULL OR operation.operation_id <> local.operation_id
                OR operation.member_digest <> local.member_digest OR operation.actor_id <> local.actor_id
                OR operation.actor_counter <> local.actor_counter OR operation.entity_id <> local.entity_id
                OR operation.mutation_id <> local.mutation_id)
          )
      )
      OR EXISTS (
        SELECT 1 FROM library_intent_results AS result
        WHERE result.transaction_id = intent.transaction_id AND result.actor_id = intent.actor_id
          AND result.intent_epoch_id = intent.intent_epoch_id
          AND json_extract(CAST(result.canonical_result AS TEXT), '$.transaction_id') = intent.transaction_id
          AND json_extract(CAST(result.canonical_result AS TEXT), '$.transaction_digest') = intent.transaction_digest
          AND json_extract(CAST(result.canonical_result AS TEXT), '$.library_id') = meta.library_id
          AND json_extract(CAST(result.canonical_result AS TEXT), '$.actor_id') = intent.actor_id
          AND json_extract(CAST(result.canonical_result AS TEXT), '$.intent_epoch_id') = intent.intent_epoch_id
          AND json_extract(CAST(result.canonical_result AS TEXT), '$.epoch_id') = result.authority_epoch_id
          AND json_extract(CAST(result.canonical_result AS TEXT), '$.status') = result.status
          AND json_extract(CAST(result.canonical_result AS TEXT), '$.result_body_digest') = result.result_digest
          AND json_extract(CAST(result.canonical_result AS TEXT), '$.authoritative_source_revision') = result.authoritative_source_revision
          AND (
            result.status = 'rejected'
            OR (
              result.status IN ('accepted', 'already_applied')
              AND result.authority_epoch_id = intent.intent_epoch_id
              AND (result.status = 'accepted' OR length(json_extract(CAST(result.canonical_result AS TEXT), '$.original_result_digest')) = 64)
              AND EXISTS (
                SELECT 1 FROM library_follower_checkpoint_receipt AS checkpoint
                JOIN library_active_authority AS active
                  ON active.library_id = checkpoint.library_id AND active.epoch_id = checkpoint.authority_epoch_id
                WHERE checkpoint.singleton_id = 1 AND checkpoint.library_id = meta.library_id
                  AND checkpoint.authority_epoch_id = result.authority_epoch_id
                  AND checkpoint.source_revision >= result.authoritative_source_revision
              )
            )
          )
      )
    )
);
