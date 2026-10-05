//! Read-only Drive verification. No renderer-supplied URL, decoded checkpoint,
//! success flag or revision can substitute for these authenticated native reads.
use freed_library_core::HandoffVerificationPlanV1;
use std::time::Duration;

pub(super) struct VerifiedRemoteHandoff {
    pub(super) plan: HandoffVerificationPlanV1,
    pub(super) control_revision: String,
}

trait DriveReadTransport {
    async fn read(&self, file_id: &str, metadata: bool, maximum: usize) -> Result<Vec<u8>, String>;
}
struct DriveReader {
    client: reqwest::Client,
    token: String,
}
impl DriveReadTransport for DriveReader {
    async fn read(&self, file_id: &str, metadata: bool, maximum: usize) -> Result<Vec<u8>, String> {
        if file_id.is_empty()
            || file_id.len() > 1024
            || !file_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return Err("Drive verification file identity is invalid".into());
        }
        let url = if metadata {
            format!("https://www.googleapis.com/drive/v2/files/{file_id}?fields=id,etag")
        } else {
            format!("https://www.googleapis.com/drive/v3/files/{file_id}?alt=media")
        };
        self.read_url(&url, maximum).await
    }
}
impl DriveReader {
    fn new(token: String) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .build()
            .map_err(|_| "Drive verification client could not start")?;
        Ok(Self { client, token })
    }

    // The only production caller constructs a fixed Drive URL from a validated
    // file ID. Keeping the request here also permits real HTTP fault fixtures.
    async fn read_url(&self, url: &str, maximum: usize) -> Result<Vec<u8>, String> {
        let response = self
            .client
            .get(url)
            .bearer_auth(&self.token)
            .header(reqwest::header::ACCEPT_ENCODING, "identity")
            .header(reqwest::header::CACHE_CONTROL, "no-cache")
            .send()
            .await
            .map_err(|_| "Drive handoff verification request failed")?;
        if !response.status().is_success() {
            return Err(format!(
                "Drive handoff verification returned HTTP {}",
                response.status().as_u16()
            ));
        }
        bounded_body(response, maximum).await
    }
}
async fn bounded_body(mut response: reqwest::Response, maximum: usize) -> Result<Vec<u8>, String> {
    if let Some(declared) = response.headers().get(reqwest::header::CONTENT_LENGTH) {
        let declared = declared
            .to_str()
            .map_err(|_| "Drive response length is invalid")?
            .parse::<u64>()
            .map_err(|_| "Drive response length is invalid")?;
        if declared > maximum as u64 {
            return Err("Drive verification response exceeds its byte bound".into());
        }
    }
    if response
        .content_length()
        .is_some_and(|length| length > maximum as u64)
    {
        return Err("Drive verification response exceeds its byte bound".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Drive verification response was interrupted")?
    {
        if chunk.len() > maximum.saturating_sub(bytes.len()) {
            return Err("Drive verification response exceeds its byte bound".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct RevisionMetadata {
    id: String,
    etag: String,
}
async fn revision(transport: &impl DriveReadTransport, file: &str) -> Result<String, String> {
    let bytes = transport.read(file, true, 65_536).await?;
    let metadata: RevisionMetadata =
        serde_json::from_slice(&bytes).map_err(|_| "Drive revision metadata is invalid")?;
    if metadata.id != file
        || metadata.etag.len() < 3
        || metadata.etag.len() > 1024
        || !metadata.etag.starts_with('"')
        || !metadata.etag.ends_with('"')
        || metadata.etag.bytes().any(|b| b < 0x20 || b == 0x7f)
        || metadata.etag.as_bytes()[1..metadata.etag.len() - 1].contains(&b'"')
    {
        return Err("Drive revision identity is invalid".into());
    }
    Ok(metadata.etag)
}
async fn read_consistent_control(
    transport: &impl DriveReadTransport,
    file_id: &str,
) -> Result<(Vec<u8>, String), String> {
    for _ in 0..3 {
        let before = revision(transport, file_id).await?;
        let bytes = transport.read(file_id, false, 65_536).await?;
        let after = revision(transport, file_id).await?;
        if before == after {
            return Ok((bytes, after));
        }
    }
    Err("Drive authority changed during handoff verification".into())
}
async fn consistent_control(
    transport: &impl DriveReadTransport,
    plan: &HandoffVerificationPlanV1,
) -> Result<String, String> {
    let (bytes, revision) = read_consistent_control(transport, plan.control_file_id()).await?;
    plan.verify_control_read(&bytes, &revision)?;
    Ok(revision)
}
async fn verify_with_transport(
    plan: HandoffVerificationPlanV1,
    transport: &impl DriveReadTransport,
) -> Result<VerifiedRemoteHandoff, String> {
    let initial_revision = consistent_control(transport, &plan).await?;
    let limit =
        usize::try_from(plan.manifest_byte_length()).map_err(|_| "manifest size is invalid")?;
    if limit == 0 || limit > 1_048_576 {
        return Err("manifest exceeds its byte bound".into());
    }
    let bytes = transport
        .read(plan.manifest_file_id(), false, limit)
        .await?;
    let (plan, pages) = tokio::task::spawn_blocking(move || {
        let pages = plan.verify_manifest(&bytes)?;
        Ok::<_, String>((plan, pages))
    })
    .await
    .map_err(|_| "native manifest verifier stopped")??;
    let mut verifier = plan.checkpoint_verifier()?;
    for page in pages {
        let limit = usize::try_from(page.stored_byte_length())
            .map_err(|_| "checkpoint page size is invalid")?;
        if limit == 0 || limit >= 5_000_000 {
            return Err("checkpoint page exceeds its byte bound".into());
        }
        let bytes = transport.read(page.file_id(), false, limit).await?;
        verifier = tokio::task::spawn_blocking(move || {
            page.verify_stored_bytes(&bytes)?;
            // MultiGzDecoder forces validation through all members and trailers.
            // The frame parser rejects trailing decoded data and caps expansion.
            verifier
                .push_manifest_page(flate2::read::MultiGzDecoder::new(bytes.as_slice()), &page)?;
            Ok::<_, String>(verifier)
        })
        .await
        .map_err(|_| "native checkpoint verifier stopped")??;
    }
    verifier.finish()?;
    let final_revision = consistent_control(transport, &plan).await?;
    if final_revision != initial_revision {
        return Err("Drive authority changed while verifying checkpoint objects".into());
    }
    Ok(VerifiedRemoteHandoff {
        plan,
        control_revision: final_revision,
    })
}

pub(super) async fn verify_remote_handoff(
    plan: HandoffVerificationPlanV1,
    access_token: String,
) -> Result<VerifiedRemoteHandoff, String> {
    if access_token.is_empty()
        || access_token.len() > 16_384
        || access_token.bytes().any(|b| b < 0x20 || b == 0x7f)
    {
        return Err("Drive verification credential is invalid".into());
    }
    let transport = DriveReader::new(access_token)?;
    tokio::time::timeout(
        Duration::from_secs(900),
        verify_with_transport(plan, &transport),
    )
    .await
    .map_err(|_| "Drive handoff verification deadline expired")?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    struct HttpFixture {
        url: String,
        requests: Arc<Mutex<Vec<String>>>,
        server: tokio::task::JoinHandle<()>,
    }
    impl HttpFixture {
        async fn start(response: Vec<u8>) -> Self {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/object", listener.local_addr().unwrap());
            let requests = Arc::new(Mutex::new(Vec::new()));
            let captured = Arc::clone(&requests);
            let server = tokio::spawn(async move {
                loop {
                    let (mut stream, _) = listener.accept().await.unwrap();
                    let mut request = Vec::new();
                    let mut buffer = [0; 1024];
                    while !request.ends_with(b"\r\n\r\n") {
                        let count = stream.read(&mut buffer).await.unwrap();
                        if count == 0 {
                            break;
                        }
                        request.extend_from_slice(&buffer[..count]);
                        assert!(request.len() <= 8192, "fixture request exceeded its bound");
                    }
                    captured
                        .lock()
                        .unwrap()
                        .push(String::from_utf8(request).unwrap());
                    // An oversized response may be rejected before the server
                    // finishes writing. That disconnect is part of the fixture.
                    let _ = stream.write_all(&response).await;
                    let _ = stream.shutdown().await;
                }
            });
            Self {
                url,
                requests,
                server,
            }
        }

        async fn read(&self, maximum: usize) -> Result<Vec<u8>, String> {
            let reader = DriveReader::new("synthetic-handoff-token".into()).unwrap();
            tokio::time::timeout(Duration::from_secs(2), reader.read_url(&self.url, maximum))
                .await
                .expect("local HTTP fixture did not settle")
        }
    }
    impl Drop for HttpFixture {
        fn drop(&mut self) {
            self.server.abort();
        }
    }

    #[tokio::test]
    async fn http_status_failures_do_not_retry_or_follow_redirects() {
        for status in [302, 401, 403, 429, 503] {
            let fixture = HttpFixture::start(
                format!("HTTP/1.1 {status} Fixture\r\nLocation: /unexpected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    .into_bytes(),
            )
            .await;
            assert_eq!(
                fixture.read(64).await.unwrap_err(),
                format!("Drive handoff verification returned HTTP {status}")
            );
            let requests = fixture.requests.lock().unwrap();
            assert_eq!(requests.len(), 1);
            let request = requests[0].to_ascii_lowercase();
            assert!(request.starts_with("get /object http/1.1\r\n"));
            assert!(request.contains("\r\nauthorization: bearer synthetic-handoff-token\r\n"));
            assert!(request.contains("\r\naccept-encoding: identity\r\n"));
            assert!(request.contains("\r\ncache-control: no-cache\r\n"));
            assert!(!request.contains("\r\ncookie:"));
        }
    }

    #[tokio::test]
    async fn http_preserves_stored_bytes_without_automatic_decompression() {
        use std::io::Write;
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(b"immutable checkpoint bytes").unwrap();
        let stored = encoder.finish().unwrap();
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            stored.len()
        )
        .into_bytes();
        response.extend_from_slice(&stored);
        let fixture = HttpFixture::start(response).await;
        assert_eq!(fixture.read(stored.len()).await.unwrap(), stored);
        assert_eq!(fixture.requests.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn http_rejects_oversized_and_interrupted_wire_bodies() {
        for (response, expected) in [
            (
                "HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\nabc",
                "Drive verification response exceeds its byte bound",
            ),
            (
                "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n3\r\nabc\r\n3\r\ndef\r\n0\r\n\r\n",
                "Drive verification response exceeds its byte bound",
            ),
            (
                "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\nab",
                "Drive verification response was interrupted",
            ),
        ] {
            let fixture = HttpFixture::start(response.as_bytes().to_vec()).await;
            assert_eq!(fixture.read(4).await.unwrap_err(), expected);
            assert_eq!(fixture.requests.lock().unwrap().len(), 1);
        }
    }

    struct FakeReader {
        replies: RefCell<VecDeque<Result<Vec<u8>, String>>>,
        calls: RefCell<Vec<(String, bool, usize)>>,
    }
    impl FakeReader {
        fn new(replies: Vec<Result<Vec<u8>, String>>) -> Self {
            Self {
                replies: RefCell::new(replies.into()),
                calls: RefCell::new(vec![]),
            }
        }
    }
    impl DriveReadTransport for FakeReader {
        async fn read(
            &self,
            file: &str,
            metadata: bool,
            maximum: usize,
        ) -> Result<Vec<u8>, String> {
            self.calls
                .borrow_mut()
                .push((file.into(), metadata, maximum));
            self.replies
                .borrow_mut()
                .pop_front()
                .expect("unexpected request")
        }
    }
    fn metadata(id: &str, etag: &str) -> Result<Vec<u8>, String> {
        Ok(serde_json::to_vec(&serde_json::json!({"id": id, "etag": etag})).unwrap())
    }
    #[tokio::test]
    async fn stable_read_binds_media_to_matching_revisions_and_exact_file() {
        let transport = FakeReader::new(vec![
            metadata("control", "\"old\""),
            Ok(b"stale".to_vec()),
            metadata("control", "\"new\""),
            metadata("control", "\"new\""),
            Ok(b"current".to_vec()),
            metadata("control", "\"new\""),
        ]);
        assert_eq!(
            read_consistent_control(&transport, "control")
                .await
                .unwrap(),
            (b"current".to_vec(), "\"new\"".into())
        );
        assert_eq!(
            transport
                .calls
                .borrow()
                .iter()
                .map(|call| call.1)
                .collect::<Vec<_>>(),
            vec![true, false, true, true, false, true]
        );
        assert!(transport
            .calls
            .borrow()
            .iter()
            .all(|call| call.0 == "control" && call.2 == 65_536));
    }
    #[tokio::test]
    async fn revision_churn_is_bounded_and_transport_errors_are_not_retried() {
        let mut replies = Vec::new();
        for _ in 0..3 {
            replies.extend([
                metadata("control", "\"a\""),
                Ok(b"body".to_vec()),
                metadata("control", "\"b\""),
            ]);
        }
        let transport = FakeReader::new(replies);
        assert!(read_consistent_control(&transport, "control")
            .await
            .is_err());
        assert_eq!(transport.calls.borrow().len(), 9);
        let transport = FakeReader::new(vec![Err("expired credential".into())]);
        assert!(read_consistent_control(&transport, "control")
            .await
            .is_err());
        assert_eq!(transport.calls.borrow().len(), 1);
    }
    #[tokio::test]
    async fn refuses_wrong_file_weak_revision_and_ambiguous_metadata() {
        for reply in [
            metadata("other", "\"strong\""),
            metadata("control", "W/\"weak\""),
            metadata("control", "\"\""),
            Ok(br#"{"id":"control","id":"other","etag":"bad"}"#.to_vec()),
        ] {
            let transport = FakeReader::new(vec![reply]);
            assert!(read_consistent_control(&transport, "control")
                .await
                .is_err());
            assert_eq!(transport.calls.borrow().len(), 1);
        }
    }
    #[tokio::test]
    async fn response_limits_check_both_headers_and_actual_streamed_bytes() {
        let response = tauri::http::Response::builder()
            .header("content-length", "1000")
            .body("abc")
            .unwrap();
        assert!(bounded_body(response.into(), 3).await.is_err());
        let response = tauri::http::Response::builder()
            .header("content-length", "1")
            .body("abc")
            .unwrap();
        assert!(bounded_body(response.into(), 2).await.is_err());
        let response = tauri::http::Response::builder().body("abc").unwrap();
        assert_eq!(bounded_body(response.into(), 3).await.unwrap(), b"abc");
        let chunks = futures_util::stream::iter(vec![
            Ok::<_, std::io::Error>(b"a".to_vec()),
            Err(std::io::Error::other("interrupted")),
        ]);
        let response = tauri::http::Response::builder()
            .body(reqwest::Body::wrap_stream(chunks))
            .unwrap();
        assert!(bounded_body(response.into(), 3).await.is_err());
    }
}
