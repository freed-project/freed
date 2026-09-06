//! Disposable device-local avatars. Canonical profile URLs are never rewritten.
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr},
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::sync::{Mutex, Semaphore};

const MAX_BYTES: usize = 2 * 1024 * 1024;
const MAGIC: &[u8; 4] = b"FAV1";
const HEADER_BYTES: usize = 36;
const FAILED_ATTEMPT_COOLDOWN: Duration = Duration::from_secs(15 * 60);

pub(crate) struct AvatarCache {
    slots: Semaphore,
    transfers: Semaphore,
    // Fixed stripes deduplicate concurrent requests without a URL-sized registry.
    stripes: [Mutex<()>; 32],
}

impl Default for AvatarCache {
    fn default() -> Self {
        Self {
            slots: Semaphore::new(192),
            transfers: Semaphore::new(2),
            stripes: std::array::from_fn(|_| Mutex::new(())),
        }
    }
}

fn source_url(source: &str) -> Result<url::Url, &'static str> {
    if source.len() > 8192 {
        return Err("avatar_url_too_long");
    }
    let mut url = url::Url::parse(source).map_err(|_| "avatar_url_invalid")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
    {
        return Err("avatar_url_not_public_https");
    }
    url.set_fragment(None);
    Ok(url)
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0
        || a == 10
        || a == 127
        || a >= 224
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && (b == 168 || (b == 0 && (c == 0 || c == 2))))
        || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
        || (a == 203 && b == 0 && c == 113))
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => public_v4(ip),
        IpAddr::V6(ip) => {
            let s = ip.segments();
            // Public unicast only, excluding mapped, local, tunnel and documentation ranges.
            s[0] & 0xe000 == 0x2000
                && !(s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8))
                && s[0] != 0x2002
                && !(s[0] == 0x3fff && s[1] < 0x1000)
        }
    }
}

fn media_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn read_cached(path: &Path) -> Option<Vec<u8>> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > (MAX_BYTES + HEADER_BYTES) as u64 {
        return None;
    }
    let mut encoded = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take((MAX_BYTES + HEADER_BYTES + 1) as u64)
        .read_to_end(&mut encoded)
        .ok()?;
    if encoded.len() < HEADER_BYTES
        || encoded.len() > MAX_BYTES + HEADER_BYTES
        || &encoded[..4] != MAGIC
    {
        return None;
    }
    let bytes = &encoded[HEADER_BYTES..];
    if Sha256::digest(bytes).as_slice() != &encoded[4..HEADER_BYTES] || media_type(bytes).is_none()
    {
        return None;
    }
    Some(bytes.to_vec())
}

fn publish(root: &Path, path: &Path, bytes: &[u8]) -> Result<(), &'static str> {
    if bytes.len() > MAX_BYTES || media_type(bytes).is_none() {
        return Err("avatar_image_invalid");
    }
    std::fs::create_dir_all(root).map_err(|_| "avatar_cache_unavailable")?;
    let mut file = tempfile::NamedTempFile::new_in(root).map_err(|_| "avatar_cache_unavailable")?;
    file.write_all(MAGIC)
        .and_then(|_| file.write_all(&Sha256::digest(bytes)))
        .and_then(|_| file.write_all(bytes))
        .and_then(|_| file.as_file().sync_all())
        .map_err(|_| "avatar_cache_write_failed")?;
    file.persist(path)
        .map_err(|_| "avatar_cache_publish_failed")?;
    #[cfg(unix)]
    std::fs::File::open(root)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| "avatar_cache_publish_failed")?;
    Ok(())
}

fn begin_attempt(root: &Path, path: &Path) -> Result<(), &'static str> {
    if std::fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .is_some_and(|modified| modified.elapsed().unwrap_or_default() < FAILED_ATTEMPT_COOLDOWN)
    {
        return Err("avatar_recent_attempt");
    }
    std::fs::create_dir_all(root).map_err(|_| "avatar_cache_unavailable")?;
    let file = tempfile::NamedTempFile::new_in(root).map_err(|_| "avatar_cache_unavailable")?;
    file.as_file()
        .sync_all()
        .map_err(|_| "avatar_cache_write_failed")?;
    file.persist(path)
        .map_err(|_| "avatar_cache_publish_failed")?;
    Ok(())
}

async fn download(mut url: url::Url) -> Result<Vec<u8>, &'static str> {
    for _ in 0..=3 {
        let host = url.host_str().ok_or("avatar_url_invalid")?;
        let addresses: Vec<_> = tokio::net::lookup_host((host, 443))
            .await
            .map_err(|_| "avatar_dns_failed")?
            .take(16)
            .collect();
        if addresses.is_empty() || addresses.iter().any(|address| !public_ip(address.ip())) {
            return Err("avatar_address_denied");
        }
        // Pin the validated resolution, including at each redirect. No cookies, proxy or retries.
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(15))
            .resolve_to_addrs(host, &addresses)
            .user_agent("Freed/1.0 (https://freed.wtf)")
            .build()
            .map_err(|_| "avatar_client_failed")?;
        let response = client
            .get(url.clone())
            .header("Accept", "image/png,image/jpeg,image/webp,image/gif")
            .send()
            .await
            .map_err(|_| "avatar_download_failed")?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or("avatar_redirect_invalid")?;
            url = source_url(
                url.join(location)
                    .map_err(|_| "avatar_redirect_invalid")?
                    .as_str(),
            )?;
            continue;
        }
        if !response.status().is_success() {
            return Err("avatar_http_failed");
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_BYTES as u64)
        {
            return Err("avatar_too_large");
        }
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "avatar_download_failed")?;
            if chunk.len() > MAX_BYTES - bytes.len() {
                return Err("avatar_too_large");
            }
            bytes.extend_from_slice(&chunk);
        }
        if media_type(&bytes).is_none() {
            return Err("avatar_image_invalid");
        }
        return Ok(bytes);
    }
    Err("avatar_redirect_limit")
}

impl AvatarCache {
    pub(crate) async fn get(
        &self,
        root: PathBuf,
        source: &str,
    ) -> Result<(Vec<u8>, &'static str), &'static str> {
        self.get_with(root, source, download).await
    }

    async fn get_with<F, Fut>(
        &self,
        root: PathBuf,
        source: &str,
        fetch: F,
    ) -> Result<(Vec<u8>, &'static str), &'static str>
    where
        F: FnOnce(url::Url) -> Fut,
        Fut: std::future::Future<Output = Result<Vec<u8>, &'static str>>,
    {
        let url = source_url(source)?;
        let digest = Sha256::digest(url.as_str().as_bytes());
        let key: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = root.join(format!("{key}.avatar"));
        let _slot = self.slots.try_acquire().map_err(|_| "avatar_queue_full")?;
        tokio::time::timeout(Duration::from_secs(30), async {
            let _stripe = self.stripes[digest[0] as usize % self.stripes.len()]
                .lock()
                .await;
            // Bound disk reads as well as network buffers.
            let _transfer = self
                .transfers
                .acquire()
                .await
                .map_err(|_| "avatar_cache_unavailable")?;
            let read_path = path.clone();
            if let Some(bytes) = tokio::task::spawn_blocking(move || read_cached(&read_path))
                .await
                .map_err(|_| "avatar_cache_read_failed")?
            {
                let kind = media_type(&bytes).ok_or("avatar_image_invalid")?;
                return Ok((bytes, kind));
            }
            // Persist attempts before contacting the host so repeated views,
            // discovery passes and process restarts cannot create retry storms.
            let attempt_root = root.clone();
            let attempt_path = path.with_extension("attempt");
            tokio::task::spawn_blocking(move || begin_attempt(&attempt_root, &attempt_path))
                .await
                .map_err(|_| "avatar_cache_write_failed")??;
            let bytes = fetch(url).await?;
            let kind = media_type(&bytes).ok_or("avatar_image_invalid")?;
            let bytes = tokio::task::spawn_blocking(move || {
                publish(&root, &path, &bytes)?;
                Ok::<_, &'static str>(bytes)
            })
            .await
            .map_err(|_| "avatar_cache_write_failed")??;
            Ok((bytes, kind))
        })
        .await
        .map_err(|_| "avatar_timeout")?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfixture";

    #[tokio::test]
    async fn restart_reads_cached_bytes_without_provider_contact_and_new_urls_do_not_reuse_them() {
        let dir = tempfile::tempdir().unwrap();
        let first = AvatarCache::default()
            .get_with(
                dir.path().into(),
                "https://images.example/avatar?v=1",
                |_| async { Ok(PNG.to_vec()) },
            )
            .await
            .unwrap();
        let reopened = AvatarCache::default();
        let cached = reopened
            .get_with(
                dir.path().into(),
                "https://images.example/avatar?v=1",
                |_| async { panic!("cached avatar contacted provider") },
            )
            .await
            .unwrap();
        assert_eq!(first, cached);
        assert_eq!(
            reopened
                .get_with(
                    dir.path().into(),
                    "https://images.example/avatar?v=2",
                    |_| async { Err("offline") }
                )
                .await
                .unwrap_err(),
            "offline"
        );
    }

    #[tokio::test]
    async fn failed_download_is_not_retried_by_a_second_view_or_restart() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            AvatarCache::default()
                .get_with(
                    dir.path().into(),
                    "https://images.example/missing",
                    |_| async { Err("offline") }
                )
                .await
                .unwrap_err(),
            "offline"
        );
        assert_eq!(
            AvatarCache::default()
                .get_with(
                    dir.path().into(),
                    "https://images.example/missing",
                    |_| async { panic!("failed image retried during cooldown") }
                )
                .await
                .unwrap_err(),
            "avatar_recent_attempt"
        );
    }

    #[test]
    fn rejects_unsafe_sources_private_addresses_and_non_image_or_oversized_cache_entries() {
        for source in [
            "http://images.example/a",
            "file:///a",
            "https://user:pass@images.example/a",
            "https://images.example:8443/a",
        ] {
            assert!(source_url(source).is_err());
        }
        for address in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
            "2002:7f00:1::",
        ] {
            assert!(!public_ip(address.parse().unwrap()));
        }
        for address in ["8.8.8.8", "2606:4700::1111"] {
            assert!(public_ip(address.parse().unwrap()));
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fixture.avatar");
        assert!(publish(dir.path(), &path, b"<svg></svg>").is_err());
        let mut oversized = PNG.to_vec();
        oversized.resize(MAX_BYTES + 1, 0);
        assert!(publish(dir.path(), &path, &oversized).is_err());
        publish(dir.path(), &path, PNG).unwrap();
        assert_eq!(read_cached(&path).unwrap(), PNG);
        let mut corrupt = std::fs::read(&path).unwrap();
        corrupt[HEADER_BYTES] ^= 1;
        std::fs::write(&path, corrupt).unwrap();
        assert!(read_cached(&path).is_none());
    }
}
