//! Bounded verification of remote checkpoint frames against a staged handoff.
//! The Desktop transport supplies a bounded gzip reader. This module neither
//! trusts renderer-decoded records nor changes local canonical state.
use crate::library_core_canonical::{decode_canonical_value, encode_canonical_value};
use crate::library_core_hash::is_lower_sha256;
use crate::normalized_checkpoint::NormalizedCheckpointRecordV2;
use crate::normalized_import::NormalizedCheckpointDigestAccumulatorV2;
use crate::sqlite_contract_generated::{
    CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES, CHECKPOINT_PAGE_MAXIMUM_RECORDS,
    CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
};
use std::io::Read;

/// A native snapshot of the only proposal this installation may activate.
/// The constructor reads SQLite itself; callers cannot supply a replacement
/// expected digest or file locator through renderer arguments.
pub struct HandoffVerificationPlanV1 {
    pub(crate) canonical_proposal: Vec<u8>,
    pub(crate) proposal: crate::normalized_handoff_certificate::HandoffActivationProposalV1,
    pub(crate) expected_control: Vec<u8>,
    pub(crate) expected_records: u64,
    pub(crate) source_stage_id: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HandoffManifestPageV1 {
    pub(crate) first_record_identity: String,
    pub(crate) last_record_identity: String,
    pub(crate) object: crate::normalized_handoff_certificate::HandoffObjectReferenceV1,
    pub(crate) page_index: usize,
    pub(crate) record_count: u64,
}

impl HandoffManifestPageV1 {
    pub fn file_id(&self) -> &str {
        &self.object.transport_object_id
    }
    pub fn stored_byte_length(&self) -> u64 {
        self.object.descriptor.byte_length
    }
    pub fn verify_stored_bytes(&self, bytes: &[u8]) -> Result<(), String> {
        use sha2::{Digest, Sha256};
        if bytes.len() as u64 != self.object.descriptor.byte_length
            || bytes.len() >= 5_000_000
            || crate::library_core_hash::lower_hex(&Sha256::digest(bytes))
                != self.object.descriptor.content_digest
        {
            return Err("remote checkpoint page bytes differ from the manifest".into());
        }
        Ok(())
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HandoffManifestV1 {
    causal_frontier_digest: String,
    dataset_schema_id: String,
    generation: u64,
    kind: String,
    library_id: String,
    pages: Vec<HandoffManifestPageV1>,
    protocol_version: u32,
    schema_version: u32,
    storage_epoch: String,
    total_record_count: u64,
}

impl HandoffVerificationPlanV1 {
    pub fn control_file_id(&self) -> &str {
        &self.proposal.control_file_id
    }
    pub fn manifest_file_id(&self) -> &str {
        &self.proposal.control.manifest.transport_object_id
    }
    pub fn manifest_byte_length(&self) -> u64 {
        self.proposal.control.manifest.descriptor.byte_length
    }

    pub fn from_target(
        connection: &mut rusqlite::Connection,
        handoff_id: &str,
    ) -> Result<Self, String> {
        use crate::normalized_handoff_certificate::{
            canonical_handoff_bytes, validate_handoff_activation_control_v1,
            verify_staged_handoff_export_v1, HandoffActivationProposalV1,
        };
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        crate::normalized_sqlite::install_normalized_schema_v1(&tx).map_err(|e| e.to_string())?;
        verify_staged_handoff_export_v1(&tx, handoff_id)?;
        let (bytes, expected_revision): (Vec<u8>, String) = tx
            .query_row(
                "SELECT canonical_activation, expected_control_revision FROM library_local_handoff
             WHERE singleton_id = 1 AND handoff_id = ?1;",
                [handoff_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| "native handoff activation proposal is missing")?;
        let proposal: HandoffActivationProposalV1 = serde_json::from_value(
            decode_canonical_value(&bytes, 32_768)
                .map_err(|_| "native handoff proposal is invalid")?
                .into_value(),
        )
        .map_err(|_| "native handoff proposal shape is invalid")?;
        if canonical_handoff_bytes(&proposal)? != bytes
            || proposal.format != "freed_library_handoff_activation_proposal_v1"
            || proposal.handoff_id != handoff_id
            || proposal.expected_control_revision != expected_revision
            || proposal.control_file_id.is_empty()
            || proposal.control_file_id.len() > 1024
            || !proposal
                .control_file_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return Err("native handoff proposal identity changed".into());
        }
        crate::normalized_handoff_certificate::require_handoff_control_file_v1(
            &tx,
            &proposal.control_file_id,
        )?;
        let snapshot = crate::normalized_sqlite::describe_normalized_checkpoint_export_v2(&tx)
            .map_err(|e| e.to_string())?;
        validate_handoff_activation_control_v1(&proposal.control, &snapshot)?;
        let selected_digest = crate::normalized_import::selected_checkpoint_digest_v2(&tx)
            .map_err(|e| e.to_string())?;
        if selected_digest != proposal.successor_checkpoint_digest {
            return Err("staged checkpoint changed after activation proposal".into());
        }
        let expected_control = canonical_handoff_bytes(&proposal.control)?;
        let plan = Self {
            canonical_proposal: bytes,
            proposal,
            expected_control,
            source_stage_id: None,
            expected_records: u64::try_from(snapshot.record_count)
                .map_err(|_| "handoff record count is invalid")?,
        };
        tx.commit().map_err(|e| e.to_string())?;
        Ok(plan)
    }

    /// Transport must obtain these bytes and this strong revision from one
    /// consistent remote read. A caller-provided success flag is insufficient.
    pub fn verify_control_read(&self, bytes: &[u8], revision: &str) -> Result<(), String> {
        if revision.len() < 3
            || revision.len() > 1024
            || !revision.starts_with('"')
            || !revision.ends_with('"')
            || revision.bytes().any(|b| b < 0x20 || b == 0x7f)
            || revision.as_bytes()[1..revision.len() - 1].contains(&b'"')
            || bytes != self.expected_control
        {
            return Err("remote authority head does not match the native handoff proposal".into());
        }
        Ok(())
    }

    pub fn verify_manifest(&self, bytes: &[u8]) -> Result<Vec<HandoffManifestPageV1>, String> {
        use sha2::{Digest, Sha256};
        let control = &self.proposal.control;
        let descriptor = &control.manifest.descriptor;
        if bytes.is_empty()
            || bytes.len() > 1_048_576
            || bytes.len() as u64 != descriptor.byte_length
            || crate::library_core_hash::lower_hex(&Sha256::digest(bytes))
                != descriptor.content_digest
        {
            return Err("remote handoff manifest bytes differ from the proposal".into());
        }
        let value = decode_canonical_value(bytes, 1_048_576)
            .map_err(|_| "remote handoff manifest encoding is invalid")?
            .into_value();
        if encode_canonical_value(&value, 1_048_576)
            .map_err(|_| "remote manifest exceeds bounds")?
            != bytes
        {
            return Err("remote handoff manifest bytes are not canonical".into());
        }
        let manifest: HandoffManifestV1 = serde_json::from_value(value)
            .map_err(|_| "remote handoff manifest shape is invalid")?;
        if manifest.kind != "checkpoint_manifest"
            || manifest.dataset_schema_id != "library_core_normalized_checkpoint_v2"
            || manifest.schema_version != 1
            || manifest.protocol_version != 1
            || manifest.generation != control.generation
            || manifest.library_id != control.library_id
            || manifest.storage_epoch != control.storage_epoch
            || manifest.causal_frontier_digest != control.causal_frontier_digest
            || manifest.total_record_count != self.expected_records
            || manifest.pages.is_empty()
            || manifest.pages.len() > 8192
        {
            return Err("remote manifest does not describe the staged successor".into());
        }
        let mut count = 0u64;
        let mut previous_last: Option<&str> = None;
        let mut transport_ids = std::collections::BTreeSet::new();
        for (index, page) in manifest.pages.iter().enumerate() {
            let object = &page.object.descriptor;
            if page.page_index != index
                || page.record_count == 0
                || page.record_count > CHECKPOINT_PAGE_MAXIMUM_RECORDS as u64
                || page.first_record_identity.is_empty()
                || page.first_record_identity.len() > 8192
                || page.last_record_identity.len() > 8192
                || page.first_record_identity > page.last_record_identity
                || previous_last
                    .is_some_and(|previous| previous >= page.first_record_identity.as_str())
                || !is_lower_sha256(&object.content_digest)
                || object.byte_length == 0
                || object.byte_length >= 5_000_000
                || object.object_key
                    != format!(
                        "freed-v2-checkpoint~{}~e{}~g{}~p{}~{}.fpage.gz",
                        control.library_id,
                        control.storage_epoch,
                        control.generation,
                        index,
                        object.content_digest
                    )
                || page.object.transport_object_id.is_empty()
                || page.object.transport_object_id.len() > 1024
                || !transport_ids.insert(page.object.transport_object_id.as_str())
            {
                return Err("remote handoff manifest page identity is invalid".into());
            }
            count += page.record_count;
            previous_last = Some(&page.last_record_identity);
        }
        if count != self.expected_records {
            return Err("remote manifest record total is inconsistent".into());
        }
        Ok(manifest.pages)
    }

    pub fn checkpoint_verifier(&self) -> Result<HandoffCheckpointVerifierV1, String> {
        HandoffCheckpointVerifierV1::new(
            &self.proposal.successor_checkpoint_digest,
            self.expected_records,
        )
    }
}

pub struct HandoffCheckpointVerifierV1 {
    accumulator: Option<NormalizedCheckpointDigestAccumulatorV2>,
    expected_digest: String,
    expected_records: u64,
    received_records: u64,
}

impl HandoffCheckpointVerifierV1 {
    /// Expected values must come from the persisted native activation proposal
    /// and its selected checkpoint, not a renderer's claimed cloud result.
    pub(crate) fn new(expected_digest: &str, expected_records: u64) -> Result<Self, String> {
        if !is_lower_sha256(expected_digest) || expected_records == 0 {
            return Err("handoff checkpoint expectation is invalid".into());
        }
        Ok(Self {
            accumulator: Some(NormalizedCheckpointDigestAccumulatorV2::new()),
            expected_digest: expected_digest.into(),
            expected_records,
            received_records: 0,
        })
    }

    /// A rejected frame permanently poisons this attempt. Earlier page digests
    /// cannot be reused after a truncated, malformed or reordered response.
    #[cfg(test)]
    fn push_frame(&mut self, reader: impl Read) -> Result<u64, String> {
        self.push_frame_checked(reader, None)
    }

    pub fn push_manifest_page(
        &mut self,
        reader: impl Read,
        page: &HandoffManifestPageV1,
    ) -> Result<u64, String> {
        self.push_frame_checked(reader, Some(page))
    }

    fn push_frame_checked(
        &mut self,
        mut reader: impl Read,
        expected: Option<&HandoffManifestPageV1>,
    ) -> Result<u64, String> {
        let mut accumulator = self
            .accumulator
            .take()
            .ok_or("handoff checkpoint verification has failed")?;
        let mut header = [0u8; 16];
        reader
            .read_exact(&mut header)
            .map_err(|_| "handoff checkpoint frame header is truncated")?;
        if &header[..8] != b"FRDV2FRM" || header[8..12] != [1, 1, 0, 0] {
            return Err("handoff checkpoint frame header is unsupported".into());
        }
        let count = u32::from_be_bytes(header[12..16].try_into().unwrap()) as usize;
        if count == 0
            || count > CHECKPOINT_PAGE_MAXIMUM_RECORDS
            || count as u64 > self.expected_records.saturating_sub(self.received_records)
        {
            return Err("handoff checkpoint frame record count is invalid".into());
        }
        let mut decoded_bytes = header.len();
        let mut first_identity = None;
        let mut last_identity = None;
        for _ in 0..count {
            let mut prefix = [0u8; 4];
            reader
                .read_exact(&mut prefix)
                .map_err(|_| "handoff checkpoint record length is truncated")?;
            let length = u32::from_be_bytes(prefix) as usize;
            if length == 0
                || length > CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES
                || length + 4 > CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES.saturating_sub(decoded_bytes)
            {
                return Err("handoff checkpoint frame exceeds its byte bound".into());
            }
            decoded_bytes += length + 4;
            let mut bytes = vec![0u8; length];
            reader
                .read_exact(&mut bytes)
                .map_err(|_| "handoff checkpoint record is truncated")?;
            let value = decode_canonical_value(&bytes, CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES)
                .map_err(|_| "handoff checkpoint record encoding is invalid")?
                .into_value();
            if encode_canonical_value(&value, CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES)
                .map_err(|_| "handoff checkpoint record exceeds canonical bounds")?
                != bytes
            {
                return Err("handoff checkpoint record bytes are not canonical".into());
            }
            let record: NormalizedCheckpointRecordV2 = serde_json::from_value(value)
                .map_err(|_| "handoff checkpoint record shape is invalid")?;
            accumulator.push(&record).map_err(|e| e.to_string())?;
            let primary = encode_canonical_value(&record.primary_key, 4096)
                .map_err(|_| "checkpoint primary key is invalid")?;
            let identity = format!(
                "{}:{}",
                record.registry_key,
                String::from_utf8(primary)
                    .map_err(|_| "checkpoint identity encoding is invalid")?
            );
            if first_identity.is_none() {
                first_identity = Some(identity.clone());
            }
            last_identity = Some(identity);
        }
        let mut trailing = [0u8; 1];
        if reader
            .read(&mut trailing)
            .map_err(|_| "handoff checkpoint frame read failed")?
            != 0
        {
            return Err("handoff checkpoint frame has trailing bytes".into());
        }
        if let Some(page) = expected {
            if page.record_count != count as u64
                || first_identity.as_deref() != Some(page.first_record_identity.as_str())
                || last_identity.as_deref() != Some(page.last_record_identity.as_str())
            {
                return Err("remote checkpoint frame differs from its manifest entry".into());
            }
        }
        self.received_records += count as u64;
        self.accumulator = Some(accumulator);
        Ok(count as u64)
    }

    pub fn finish(self) -> Result<(), String> {
        let accumulator = self
            .accumulator
            .ok_or("handoff checkpoint verification has failed")?;
        let (digest, count, _) = accumulator.finish();
        if count != self.expected_records || digest != self.expected_digest {
            return Err("remote checkpoint differs from the persisted handoff proposal".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::normalized_checkpoint::checked_record;
    use serde_json::json;
    fn record(tag: &str) -> NormalizedCheckpointRecordV2 {
        checked_record(
            "13_feed_item_tag",
            json!(["item", tag]),
            json!({"tag": tag}),
        )
        .unwrap()
    }
    fn frame(records: &[NormalizedCheckpointRecordV2]) -> Vec<u8> {
        let mut bytes = b"FRDV2FRM\x01\x01\x00\x00".to_vec();
        bytes.extend_from_slice(&(records.len() as u32).to_be_bytes());
        for record in records {
            let canonical = encode_canonical_value(
                &serde_json::to_value(record).unwrap(),
                CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
            )
            .unwrap();
            bytes.extend_from_slice(&(canonical.len() as u32).to_be_bytes());
            bytes.extend(canonical);
        }
        bytes
    }
    fn verifier(records: &[NormalizedCheckpointRecordV2]) -> HandoffCheckpointVerifierV1 {
        let mut accumulator = NormalizedCheckpointDigestAccumulatorV2::new();
        for record in records {
            accumulator.push(record).unwrap();
        }
        let (digest, count, _) = accumulator.finish();
        HandoffCheckpointVerifierV1::new(&digest, count).unwrap()
    }
    struct Fragmented<'a>(&'a [u8]);
    impl Read for Fragmented<'_> {
        fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
            let length = output.len().min(1);
            self.0.read(&mut output[..length])
        }
    }
    #[test]
    fn verifies_fragmented_frames_and_cross_page_digest() {
        let records = [record("a"), record("b")];
        let mut check = verifier(&records);
        for row in &records {
            check
                .push_frame(Fragmented(&frame(std::slice::from_ref(row))))
                .unwrap();
        }
        check.finish().unwrap();
    }
    #[test]
    fn rejects_truncation_trailing_data_and_reuse_after_failure() {
        let row = record("a");
        let good = frame(std::slice::from_ref(&row));
        for bytes in [
            &good[..15],
            &good[..good.len() - 1],
            &[good.as_slice(), &[0]].concat(),
        ] {
            let mut check = verifier(std::slice::from_ref(&row));
            assert!(check.push_frame(bytes).is_err());
            assert!(check.push_frame(good.as_slice()).is_err());
            assert!(check.finish().is_err());
        }
    }
    #[test]
    fn rejects_duplicate_cross_page_records_and_wrong_digest() {
        let a = record("a");
        let b = record("b");
        let mut check = verifier(&[a.clone(), b.clone()]);
        check
            .push_frame(frame(std::slice::from_ref(&a)).as_slice())
            .unwrap();
        assert!(check
            .push_frame(frame(std::slice::from_ref(&a)).as_slice())
            .is_err());
        let mut check = verifier(&[a]);
        check.push_frame(frame(&[b]).as_slice()).unwrap();
        assert!(check.finish().is_err());
    }
    #[test]
    fn refuses_oversized_advertised_records_before_reading_their_payload() {
        let row = record("a");
        let mut bytes = frame(std::slice::from_ref(&row));
        bytes.truncate(20);
        bytes[16..20].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(verifier(&[row])
            .push_frame(bytes.as_slice())
            .unwrap_err()
            .contains("byte bound"));
    }
    #[test]
    fn rejects_future_kind_reserved_fields_and_incomplete_checkpoints() {
        let row = record("a");
        for index in [0, 8, 9, 10, 11] {
            let mut bytes = frame(std::slice::from_ref(&row));
            bytes[index] = 255;
            assert!(verifier(std::slice::from_ref(&row))
                .push_frame(bytes.as_slice())
                .is_err());
        }
        assert!(verifier(&[row]).finish().is_err());
    }
    fn manifest_fixture() -> serde_json::Value {
        json!({"causalFrontierDigest": "c".repeat(64), "datasetSchemaId": "library_core_normalized_checkpoint_v2",
        "generation": 0, "kind": "checkpoint_manifest", "libraryId": "a".repeat(64),
        "storageEpoch": "b".repeat(64), "protocolVersion": 1, "schemaVersion": 1, "totalRecordCount": 1,
        "pages": [{"firstRecordIdentity": "13_feed_item_tag:[1]", "lastRecordIdentity": "13_feed_item_tag:[1]",
            "pageIndex": 0, "recordCount": 1, "object": {"transportObjectId": "page-one", "descriptor": {
                "contentDigest": "d".repeat(64), "byteLength": 100,
                "objectKey": format!("freed-v2-checkpoint~{}~e{}~g0~p0~{}.fpage.gz", "a".repeat(64), "b".repeat(64), "d".repeat(64))
            }}}]})
    }
    fn manifest_plan(value: &serde_json::Value) -> (HandoffVerificationPlanV1, Vec<u8>) {
        use sha2::{Digest, Sha256};
        let bytes = encode_canonical_value(value, 1_048_576).unwrap();
        let digest = crate::library_core_hash::lower_hex(&Sha256::digest(&bytes));
        let proposal = serde_json::from_value(json!({
            "format": "freed_library_handoff_activation_proposal_v1", "handoff_id": "e".repeat(64),
            "control_file_id": "control", "expected_control_revision": "\"old\"", "successor_checkpoint_digest": "f".repeat(64),
            "control": {"schemaVersion": 1, "protocolVersion": 1, "libraryId": "a".repeat(64),
                "storageEpoch": "b".repeat(64), "writerId": "e".repeat(64), "generation": 0,
                "causalFrontierDigest": "c".repeat(64), "activeTransport": "google_drive_app_data_v1",
                "manifest": {"transportObjectId": "manifest", "descriptor": {"contentDigest": digest,
                    "byteLength": bytes.len(), "objectKey": "test manifest"}}}
        })).unwrap();
        (
            HandoffVerificationPlanV1 {
                proposal,
                canonical_proposal: vec![],
                expected_control: vec![],
                expected_records: 1,
                source_stage_id: None,
            },
            bytes,
        )
    }
    #[test]
    fn owner_scale_manifest_fits_but_serial_latency_requires_admission() {
        // Synthetic metadata only: no corpus allocation, network or real sleeps.
        let records = 5_072_539u64;
        let page_count = records.div_ceil(CHECKPOINT_PAGE_MAXIMUM_RECORDS as u64);
        assert_eq!(page_count, 1239);
        let mut manifest = manifest_fixture();
        manifest["totalRecordCount"] = json!(records);
        manifest["pages"] = json!((0..page_count).map(|index| {
            let first = index * CHECKPOINT_PAGE_MAXIMUM_RECORDS as u64;
            let count = (records - first).min(CHECKPOINT_PAGE_MAXIMUM_RECORDS as u64);
            json!({"firstRecordIdentity": format!("10_feed_item:[\"rss:synthetic:{first:010}\"]"),
                "lastRecordIdentity": format!("10_feed_item:[\"rss:synthetic:{:010}\"]", first+count-1),
                "pageIndex":index,"recordCount":count,"object":{"transportObjectId":format!("synthetic-drive-object-{index:040}"),
                    "descriptor":{"contentDigest":"d".repeat(64),"byteLength":262144,
                    "objectKey":format!("freed-v2-checkpoint~{}~e{}~g0~p{index}~{}.fpage.gz","a".repeat(64),"b".repeat(64),"d".repeat(64))}}})
        }).collect::<Vec<_>>());
        let (mut plan, bytes) = manifest_plan(&manifest);
        plan.expected_records = records;
        assert_eq!(
            plan.verify_manifest(&bytes).unwrap().len(),
            page_count as usize
        );
        let deadline_ms = 900_000u64;
        // Seven reads: two three-read consistent controls and one manifest.
        // Per-page CPU cost is deliberately explicit, not a measured estimate.
        let simulated = |request_ms: u64, verify_ms: u64| {
            (page_count + 7) * request_ms + page_count * verify_ms
        };
        assert!(simulated(500, 5) < deadline_ms);
        assert!(simulated(750, 5) > deadline_ms);
        eprintln!("owner scale: records={records}, pages={page_count}, manifest_bytes={}, 500ms reads+5ms verify={}ms, 750ms reads+5ms verify={}ms; no live latency claim", bytes.len(), simulated(500,5), simulated(750,5));
    }

    #[test]
    fn binds_manifest_bytes_and_successor_identity() {
        let manifest = manifest_fixture();
        let (plan, bytes) = manifest_plan(&manifest);
        let pages = plan.verify_manifest(&bytes).unwrap();
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].object.transport_object_id, "page-one");
        assert!(plan.verify_manifest(&bytes[..bytes.len() - 1]).is_err());
        let mut other = manifest;
        other["storageEpoch"] = json!("9".repeat(64));
        let (plan, bytes) = manifest_plan(&other);
        assert!(plan.verify_manifest(&bytes).is_err());
    }
    #[test]
    fn rejects_manifest_page_identity_and_record_total_mismatches() {
        for kind in 0..4 {
            let mut manifest = manifest_fixture();
            match kind {
                0 => manifest["pages"][0]["pageIndex"] = json!(1),
                1 => {
                    manifest["pages"][0]["object"]["descriptor"]["objectKey"] =
                        json!("another-library-page")
                }
                2 => manifest["pages"][0]["recordCount"] = json!(2),
                _ => manifest["pages"][0]["object"]["descriptor"]["byteLength"] = json!(5_000_000),
            }
            let (plan, bytes) = manifest_plan(&manifest);
            assert!(plan.verify_manifest(&bytes).is_err());
        }
    }
    #[test]
    fn binds_frame_count_and_record_identities_to_manifest_entry() {
        let row = record("a");
        let mut page_value = manifest_fixture()["pages"][0].clone();
        page_value["firstRecordIdentity"] = json!("13_feed_item_tag:[\"item\",\"a\"]");
        page_value["lastRecordIdentity"] = page_value["firstRecordIdentity"].clone();
        let mut page: HandoffManifestPageV1 = serde_json::from_value(page_value).unwrap();
        let mut check = verifier(std::slice::from_ref(&row));
        check
            .push_manifest_page(frame(std::slice::from_ref(&row)).as_slice(), &page)
            .unwrap();
        check.finish().unwrap();
        page.record_count = 2;
        let mut check = verifier(std::slice::from_ref(&row));
        assert!(check
            .push_manifest_page(frame(std::slice::from_ref(&row)).as_slice(), &page)
            .is_err());
        assert!(check.finish().is_err());
        page.record_count = 1;
        page.last_record_identity = "different".into();
        assert!(verifier(std::slice::from_ref(&row))
            .push_manifest_page(frame(&[row]).as_slice(), &page)
            .is_err());
    }
}
