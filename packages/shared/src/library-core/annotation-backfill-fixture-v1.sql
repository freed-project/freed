-- Relational migration fixture only. Certificates are deliberately synthetic;
-- this fixture establishes no signature, admission, or settlement authority.
INSERT INTO library_authority_epochs VALUES('epoch','library',1,printf('%064d',1),printf('%064d',2),printf('%064d',3),'{}',0,printf('%064d',4),printf('%064d',5),0);
INSERT INTO library_actors VALUES('actor','epoch','desktop',printf('%064d',2),'enrollment',printf('%064d',3),'{}',printf('%064d',4),0,NULL,printf('%064d',4),NULL,0,0);
INSERT INTO library_meta VALUES(1,'library',1,'epoch',0,0);
INSERT INTO library_active_authority VALUES('active','library','epoch','actor',0,0);
INSERT INTO library_materialization_generation VALUES(1,printf('%064d',6));
INSERT INTO library_intent_actors VALUES('actor',1026,'operation:1025',printf('%064d',7));
WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<1025)
INSERT INTO library_intent_transactions(transaction_id,transaction_digest,actor_id,intent_epoch,intent_epoch_id,member_count,first_counter,last_counter,previous_operation_id,previous_chain_digest,ending_operation_id,ending_chain_digest,canonical_member_bytes,canonical_transaction,state,created_at)
SELECT printf('transaction:%04d',n),printf('%064d',n),'actor',1,'epoch',1,n,n,CASE WHEN n=1 THEN NULL ELSE printf('operation:%d',n-1) END,printf('%064d',7),printf('operation:%d',n),printf('%064d',7),2,CAST('{}' AS BLOB),'pending',0 FROM numbers;
INSERT INTO library_intent_members
SELECT transaction_id,actor_id,0,ending_operation_id,first_counter,
 CASE WHEN first_counter<=257 THEN 'feed_item_read_assignment' ELSE 'feed_item_annotations_replace' END,
 'FeedItem',printf('item:%d',first_counter),CAST('{}' AS BLOB),transaction_digest
FROM library_intent_transactions;
