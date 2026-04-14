//! Freed Desktop Application
//!
//! Native desktop app that bundles capture, sync relay, and reader UI.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::{SinkExt, StreamExt};
use log::{error, info, warn};
use rand::RngCore;
use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock as StdRwLock};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Listener, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, RwLock};
use tokio::time::{timeout, Duration};
use tokio_tungstenite::{
    accept_hdr_async,
    tungstenite::{
        handshake::server::{ErrorResponse, Request as WsRequest, Response as WsResponse},
        Message,
    },
};

#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2_foundation::{ns_string, MainThreadMarker, NSObjectNSKeyValueCoding, NSString};
#[cfg(target_os = "macos")]
use objc2_web_kit::WKWebViewConfiguration;
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

const DEFAULT_SYNC_RELAY_PORT: u16 = 8765;

fn sync_relay_port() -> u16 {
    std::env::var("FREED_SYNC_PORT")
        .ok()
        .and_then(|raw| raw.parse::<u16>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(DEFAULT_SYNC_RELAY_PORT)
}

const DEFAULT_WEBKIT_SAFARI_UA: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15";
const ENABLE_BACKGROUND_SCRAPER_CLOAK_JS: &str = r#"
    (function() {
        var token = "__freed_background_scraper__";
        var tokens = (window.name || "").split(/\s+/).filter(Boolean).filter(function(value) {
            return value !== token;
        });
        tokens.push(token);
        window.name = tokens.join(" ");
        if (typeof window.__FREED_SET_BACKGROUND_SCRAPER_CLOAK__ === "function") {
            window.__FREED_SET_BACKGROUND_SCRAPER_CLOAK__(true);
        }
    })();
"#;
const DISABLE_BACKGROUND_SCRAPER_CLOAK_JS: &str = r#"
    (function() {
        var token = "__freed_background_scraper__";
        var tokens = (window.name || "").split(/\s+/).filter(Boolean).filter(function(value) {
            return value !== token;
        });
        window.name = tokens.join(" ");
        if (typeof window.__FREED_SET_BACKGROUND_SCRAPER_CLOAK__ === "function") {
            window.__FREED_SET_BACKGROUND_SCRAPER_CLOAK__(false);
        }
    })();
"#;
const INITIALIZE_BACKGROUND_SCRAPER_CLOAK_JS: &str = r#"
    (function() {
        var token = "__freed_background_scraper__";
        var tokens = (window.name || "").split(/\s+/).filter(Boolean).filter(function(value) {
            return value !== token;
        });
        tokens.push(token);
        window.name = tokens.join(" ");
        if (typeof window.__FREED_SET_BACKGROUND_SCRAPER_CLOAK__ === "function") {
            window.__FREED_SET_BACKGROUND_SCRAPER_CLOAK__(true);
        }
    })();
"#;
const ENABLE_BACKGROUND_SCRAPER_MEDIA_GUARD_JS: &str = r#"
    (function() {
        var token = "__freed_media_guard__";
        var tokens = (window.name || "").split(/\s+/).filter(Boolean).filter(function(value) {
            return value !== token;
        });
        tokens.push(token);
        window.name = tokens.join(" ");
        if (typeof window.__FREED_SET_BACKGROUND_SCRAPER_MEDIA_GUARD__ === "function") {
            window.__FREED_SET_BACKGROUND_SCRAPER_MEDIA_GUARD__(true);
        }
    })();
"#;
const DISABLE_BACKGROUND_SCRAPER_MEDIA_GUARD_JS: &str = r#"
    (function() {
        var token = "__freed_media_guard__";
        var tokens = (window.name || "").split(/\s+/).filter(Boolean).filter(function(value) {
            return value !== token;
        });
        window.name = tokens.join(" ");
        if (typeof window.__FREED_SET_BACKGROUND_SCRAPER_MEDIA_GUARD__ === "function") {
            window.__FREED_SET_BACKGROUND_SCRAPER_MEDIA_GUARD__(false);
        }
    })();
"#;
const INITIALIZE_BACKGROUND_SCRAPER_MEDIA_GUARD_JS: &str = r#"
    (function() {
        var token = "__freed_media_guard__";
        var tokens = (window.name || "").split(/\s+/).filter(Boolean).filter(function(value) {
            return value !== token;
        });
        tokens.push(token);
        window.name = tokens.join(" ");
        if (typeof window.__FREED_SET_BACKGROUND_SCRAPER_MEDIA_GUARD__ === "function") {
            window.__FREED_SET_BACKGROUND_SCRAPER_MEDIA_GUARD__(true);
        }
    })();
"#;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum ScraperWindowMode {
    Shown,
    Cloaked,
    Hidden,
}

impl ScraperWindowMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Shown => "shown",
            Self::Cloaked => "cloaked",
            Self::Hidden => "hidden",
        }
    }
}

fn stored_or_default_user_agent(agent: &std::sync::Mutex<String>) -> String {
    let stored = agent.lock().unwrap();
    if stored.trim().is_empty() {
        DEFAULT_WEBKIT_SAFARI_UA.to_string()
    } else {
        stored.clone()
    }
}

fn recycle_webview_window(app: &tauri::AppHandle, label: &str, reason: &str) {
    if let Some(window) = app.get_webview_window(label) {
        match window.destroy() {
            Ok(()) => info!("[window] recycled {} ({})", label, reason),
            Err(error) => error!(
                "[window] failed to recycle {} ({}): {}",
                label, reason, error
            ),
        }
    }
}

struct WebviewRecycleGuard {
    app: tauri::AppHandle,
    label: &'static str,
    reason: &'static str,
}

impl WebviewRecycleGuard {
    fn new(app: tauri::AppHandle, label: &'static str, reason: &'static str) -> Self {
        Self { app, label, reason }
    }
}

impl Drop for WebviewRecycleGuard {
    fn drop(&mut self) {
        recycle_webview_window(&self.app, self.label, self.reason);
    }
}

fn schedule_webview_recycle(
    app: tauri::AppHandle,
    label: &'static str,
    reason: &'static str,
    delay: Duration,
) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        recycle_webview_window(&app, label, reason);
    });
}

fn build_cloaked_scraper_window(
    app: &tauri::AppHandle,
    label: &str,
    title: &str,
    url: &str,
    user_agent: &str,
) -> Result<tauri::WebviewWindow, String> {
    use tauri::WebviewWindowBuilder;

    WebviewWindowBuilder::new(
        app,
        label,
        tauri::WebviewUrl::External(url.parse().map_err(|e: url::ParseError| e.to_string())?),
    )
    .user_agent(user_agent)
    .transparent(true)
    .initialization_script(include_str!("webkit-mask.js"))
    .initialization_script(INITIALIZE_BACKGROUND_SCRAPER_MEDIA_GUARD_JS)
    .title(title)
    .inner_size(1280.0, 900.0)
    .focused(false)
    .focusable(false)
    .decorations(false)
    .always_on_bottom(true)
    .skip_taskbar(true)
    .shadow(false)
    .initialization_script(INITIALIZE_BACKGROUND_SCRAPER_CLOAK_JS)
    .visible(true)
    .build()
    .map_err(|e| e.to_string())
}

fn set_background_scraper_window_cloak(
    window: &tauri::WebviewWindow,
    enabled: bool,
) -> Result<(), String> {
    window
        .eval(if enabled {
            ENABLE_BACKGROUND_SCRAPER_CLOAK_JS
        } else {
            DISABLE_BACKGROUND_SCRAPER_CLOAK_JS
        })
        .map_err(|e| e.to_string())
}

fn set_background_scraper_media_guard(
    window: &tauri::WebviewWindow,
    enabled: bool,
) -> Result<(), String> {
    window
        .eval(if enabled {
            ENABLE_BACKGROUND_SCRAPER_MEDIA_GUARD_JS
        } else {
            DISABLE_BACKGROUND_SCRAPER_MEDIA_GUARD_JS
        })
        .map_err(|e| e.to_string())
}

fn prepare_background_scraper_window(
    window: &tauri::WebviewWindow,
    window_mode: ScraperWindowMode,
) -> Result<(), String> {
    set_background_scraper_media_guard(window, true)?;
    match window_mode {
        ScraperWindowMode::Shown => {
            let _ = window.set_ignore_cursor_events(false);
            let _ = window.set_always_on_bottom(false);
            let _ = window.set_focusable(true);
            let _ = window.set_decorations(true);
            let _ = window.set_shadow(true);
            let _ = window.set_skip_taskbar(false);
            let _ = set_background_scraper_window_cloak(window, false);
            let _ = window.center();
            let _ = window.show();
            let _ = window.set_focus();
        }
        ScraperWindowMode::Cloaked => {
            let _ = window.set_skip_taskbar(true);
            let _ = window.set_visible_on_all_workspaces(false);
            let _ = window.set_decorations(false);
            let _ = window.set_shadow(false);
            let _ = window.set_always_on_bottom(true);
            let _ = window.set_focusable(false);
            let _ = window.set_ignore_cursor_events(true);
            let _ = set_background_scraper_window_cloak(window, true);
            window.show().map_err(|e| e.to_string())?;
        }
        ScraperWindowMode::Hidden => {
            let _ = window.set_skip_taskbar(true);
            let _ = window.set_visible_on_all_workspaces(false);
            let _ = window.set_decorations(false);
            let _ = window.set_shadow(false);
            let _ = window.set_always_on_bottom(true);
            let _ = window.set_focusable(false);
            let _ = window.set_ignore_cursor_events(true);
            let _ = set_background_scraper_window_cloak(window, false);
            let _ = window.hide();
        }
    }
    Ok(())
}

async fn restore_scraper_feed(
    window: &tauri::WebviewWindow,
    feed_url: &str,
    platform: &str,
) -> Result<(), String> {
    window
        .navigate(feed_url.parse::<url::Url>().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    info!("[{}] restoring feed after story viewer", platform);
    tokio::time::sleep(Duration::from_millis(gaussian_ms(6500.0, 900.0))).await;
    let _ = window.eval("window.scrollTo({ top: 0, behavior: 'instant' });");
    tokio::time::sleep(Duration::from_millis(gaussian_ms(1200.0, 250.0))).await;
    Ok(())
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

/// Generates a cryptographically random 256-bit pairing token encoded as
/// base64url without padding (43 ASCII characters).
fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Loads the pairing token from `data_dir/pairing-token`, or creates and
/// persists a fresh one if the file is missing or malformed.
fn load_or_create_token(data_dir: &std::path::Path) -> String {
    let path = data_dir.join("pairing-token");
    if let Ok(raw) = std::fs::read_to_string(&path) {
        let token = raw.trim().to_string();
        // 32 bytes base64url-no-pad → exactly 43 chars, all URL-safe
        let looks_valid = token.len() == 43
            && token
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        if looks_valid {
            return token;
        }
    }
    let token = generate_token();
    let _ = std::fs::write(&path, &token);
    token
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// mDNS advertisement
// ---------------------------------------------------------------------------

/// Keeps the mDNS daemon alive for the application lifetime.
/// The `Drop` impl shuts the daemon down cleanly on exit.
struct MdnsState(Option<mdns_sd::ServiceDaemon>);

impl Drop for MdnsState {
    fn drop(&mut self) {
        if let Some(daemon) = self.0.take() {
            let _ = daemon.shutdown();
        }
    }
}

/// Register `_freed-sync._tcp.local` so future native clients can discover
/// the relay without a QR scan.  The pairing token is intentionally absent
/// from TXT records — discovery reveals the host/port, not the secret.
fn advertise_mdns(port: u16) -> Option<mdns_sd::ServiceDaemon> {
    use mdns_sd::{ServiceDaemon, ServiceInfo};

    let daemon = ServiceDaemon::new()
        .map_err(|e| error!("[mDNS] Failed to create daemon: {}", e))
        .ok()?;

    let hostname = hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "freed-desktop".to_string());

    let fqdn = format!("{}.local.", hostname);

    let mut properties = std::collections::HashMap::new();
    properties.insert("v".to_string(), "1".to_string());
    properties.insert("app".to_string(), "freed".to_string());

    // Pass `()` so mdns-sd auto-discovers all local interfaces — avoids
    // hard-coding the LAN IP and handles multi-homed machines gracefully.
    let service = ServiceInfo::new(
        "_freed-sync._tcp.local.",
        "Freed Desktop",
        &fqdn,
        (),
        port,
        Some(properties),
    )
    .map_err(|e| error!("[mDNS] Failed to build ServiceInfo: {}", e))
    .ok()?;

    daemon
        .register(service)
        .map_err(|e| error!("[mDNS] Failed to register service: {}", e))
        .ok()?;

    info!("[mDNS] Advertising _freed-sync._tcp.local on port {}", port);
    Some(daemon)
}

// ---------------------------------------------------------------------------
// Local snapshot rotation (grandfather-father-son)
// ---------------------------------------------------------------------------

/// Write a timestamped Automerge snapshot to `{app_data}/snapshots/` and
/// prune old files using a GFS scheme:
///   - last 60 minutely  (≤ 1 hour old)
///   - last 24 hourly    (1–24 hours old)
///   - last 30 daily     (> 24 hours old)
#[cfg_attr(feature = "perf", tracing::instrument(skip(doc_bytes), fields(bytes = doc_bytes.len())))]
fn write_snapshot(snapshot_dir: &std::path::Path, doc_bytes: &[u8]) {
    use std::time::{SystemTime, UNIX_EPOCH};

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    if let Err(e) = std::fs::create_dir_all(snapshot_dir) {
        error!("[Snapshot] Failed to create dir: {}", e);
        return;
    }

    let path = snapshot_dir.join(format!("freed-{}.automerge", ts));
    if let Err(e) = std::fs::write(&path, doc_bytes) {
        error!("[Snapshot] Failed to write: {}", e);
        return;
    }

    prune_snapshots(snapshot_dir, ts);
}

#[cfg_attr(feature = "perf", tracing::instrument(skip(snapshot_dir)))]
fn prune_snapshots(snapshot_dir: &std::path::Path, now_secs: u64) {
    use std::cmp::Reverse;

    let mut entries: Vec<(u64, std::path::PathBuf)> = std::fs::read_dir(snapshot_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let ts: u64 = name
                .strip_prefix("freed-")?
                .strip_suffix(".automerge")?
                .parse()
                .ok()?;
            Some((ts, e.path()))
        })
        .collect();

    entries.sort_by_key(|(ts, _)| Reverse(*ts));

    let mut kept: HashSet<std::path::PathBuf> = Default::default();
    let (mut minutely, mut hourly, mut daily) = (0usize, 0usize, 0usize);
    let mut last_hour_bucket = u64::MAX;
    let mut last_day_bucket = u64::MAX;

    for (ts, path) in &entries {
        let age = now_secs.saturating_sub(*ts);
        if age < 3_600 && minutely < 60 {
            kept.insert(path.clone());
            minutely += 1;
        } else if age < 86_400 {
            let bucket = age / 3_600;
            if bucket != last_hour_bucket && hourly < 24 {
                kept.insert(path.clone());
                last_hour_bucket = bucket;
                hourly += 1;
            }
        } else {
            let bucket = age / 86_400;
            if bucket != last_day_bucket && daily < 30 {
                kept.insert(path.clone());
                last_day_bucket = bucket;
                daily += 1;
            }
        }
    }

    for (_, path) in &entries {
        if !kept.contains(path) {
            let _ = std::fs::remove_file(path);
        }
    }
}

// Relay state
// ---------------------------------------------------------------------------

struct SyncRelayState {
    port: u16,
    /// Broadcast channel — sends doc bytes to all connected clients.
    broadcast_tx: broadcast::Sender<Arc<Vec<u8>>>,
    /// Latest doc binary, served to new joiners immediately on connect.
    current_doc: RwLock<Option<Arc<Vec<u8>>>>,
    /// Live connection count (displayed in tray / sync indicator).
    client_count: RwLock<usize>,
    /// Pairing token — must appear as `?t=<token>` in the WS upgrade URI.
    ///
    /// Uses `std::sync::RwLock` (not Tokio's) because it is never held
    /// across an `.await` point; it is read/written synchronously and the
    /// guard is dropped before any async work begins.
    pairing_token: StdRwLock<String>,
}

type RelayState = Arc<SyncRelayState>;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeMemoryStats {
    process_resident_bytes: u64,
    process_virtual_bytes: u64,
    relay_doc_bytes: u64,
    relay_client_count: u64,
}

// ---------------------------------------------------------------------------
// Capture state — shared UA strings and HTTP client for social scrapers
// ---------------------------------------------------------------------------

/// Per-session user agent strings set by TypeScript at platform connect time,
/// plus a shared rquest HTTP client with persistent connection pooling.
struct CaptureState {
    fb_user_agent: std::sync::Mutex<String>,
    ig_user_agent: std::sync::Mutex<String>,
    li_user_agent: std::sync::Mutex<String>,
    scraper_session: Arc<tokio::sync::Mutex<()>>,
    x_client: rquest::Client,
}

impl CaptureState {
    fn new() -> Self {
        // rquest 5.x uses rquest_util::Emulation for Chrome TLS fingerprinting.
        let x_client = rquest::Client::builder()
            .emulation(rquest_util::Emulation::Chrome131)
            .no_proxy()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("Failed to build rquest client");

        Self {
            fb_user_agent: std::sync::Mutex::new(String::new()),
            ig_user_agent: std::sync::Mutex::new(String::new()),
            li_user_agent: std::sync::Mutex::new(String::new()),
            scraper_session: Arc::new(tokio::sync::Mutex::new(())),
            x_client,
        }
    }
}

struct ActiveScraperSession {
    _guard: tokio::sync::OwnedMutexGuard<()>,
    operation: &'static str,
    acquired_at: std::time::Instant,
}

impl Drop for ActiveScraperSession {
    fn drop(&mut self) {
        info!(
            "[scraper] released session op={} held_ms={}",
            self.operation,
            self.acquired_at.elapsed().as_millis()
        );
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
struct RendererHeartbeatPayload {
    seq: u64,
    ts: u64,
    reason: String,
    visibility: String,
    href: String,
}

struct RendererHeartbeatStatus {
    started_at: std::time::Instant,
    last_seen_at: Option<std::time::Instant>,
    last_seq: u64,
    last_reason: String,
    last_visibility: String,
    last_href: String,
    stale_logged: bool,
}

impl RendererHeartbeatStatus {
    fn new() -> Self {
        Self {
            started_at: std::time::Instant::now(),
            last_seen_at: None,
            last_seq: 0,
            last_reason: "startup".to_string(),
            last_visibility: "unknown".to_string(),
            last_href: String::new(),
            stale_logged: false,
        }
    }
}

fn truncate_for_log(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{}...", truncated)
    } else {
        truncated
    }
}

async fn acquire_background_scraper_session(
    capture: &CaptureState,
    operation: &'static str,
) -> ActiveScraperSession {
    let session = capture.scraper_session.clone();

    match session.clone().try_lock_owned() {
        Ok(guard) => {
            info!("[scraper] acquired session op={} wait_ms=0", operation);
            ActiveScraperSession {
                _guard: guard,
                operation,
                acquired_at: std::time::Instant::now(),
            }
        }
        Err(_) => {
            info!("[scraper] waiting for active session op={}", operation);
            let wait_started = std::time::Instant::now();
            let guard = session.lock_owned().await;
            info!(
                "[scraper] acquired session op={} wait_ms={}",
                operation,
                wait_started.elapsed().as_millis()
            );
            ActiveScraperSession {
                _guard: guard,
                operation,
                acquired_at: std::time::Instant::now(),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands — meta
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[tauri::command]
fn get_updater_target() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };

    format!("{}-{}", os, std::env::consts::ARCH)
}

// ---------------------------------------------------------------------------
// Tauri commands — contacts
// ---------------------------------------------------------------------------

/// Result type returned to the frontend for contact picking.
#[derive(serde::Serialize, serde::Deserialize, Debug)]
struct ContactResult {
    name: String,
    phone: Option<String>,
    email: Option<String>,
    address: Option<String>,
    /// Native CNContact identifier for potential future re-sync.
    native_id: Option<String>,
}

/// Present the native macOS contact picker and return the chosen contact.
///
/// Requires:
///   - `objc2-contacts` crate in Cargo.toml
///   - `NSContactsUsageDescription` key in Info.plist
///   - `com.apple.security.personal-information.addressbook` entitlement
///
/// Returns `None` when the user cancels.
/// Returns an error string if the Contacts framework is unavailable or
/// authorization is denied.
///
/// TODO: implement macOS CNContactStore picker using objc2-contacts.
/// Until then this command always returns an authorization-pending error so
/// callers can display a helpful message rather than silently failing.
#[tauri::command]
async fn pick_contact() -> Result<Option<ContactResult>, String> {
    #[cfg(target_os = "macos")]
    {
        // Placeholder until objc2-contacts is integrated.
        // Replace this block with CNContactStore + CNContactPickerViewController
        // once the entitlement and Cargo dependency are added.
        Err("Contacts integration not yet implemented — coming in a future release.".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Native contact picker is only available on macOS.".to_string())
    }
}

// ---------------------------------------------------------------------------
// Tauri commands — network / proxy
// ---------------------------------------------------------------------------

/// Fetch any URL and return its body as text (bypasses browser CORS).
#[tauri::command]
async fn fetch_url(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Freed/1.0 (https://freed.wtf)")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch {}: {}", url, e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}: {}", response.status(), url));
    }

    response.text().await.map_err(|e| e.to_string())
}

/// Make an authenticated request to the X (Twitter) API.
///
/// Supports both GET (timeline queries) and POST (mutations). The X web client
/// uses GET for read-only GraphQL queries — sending them as POST causes 422
/// GRAPHQL_VALIDATION_FAILED.
///
/// The client bypasses any system/environment proxy (`no_proxy`) and connects
/// directly to x.com. This matters in dev where the shell may export an
/// HTTPS_PROXY (e.g. Cursor's safe-chain) whose TLS cert is not trusted by
/// the Rust native-tls stack, causing a silent connection failure.
#[tauri::command]
async fn x_api_request(
    capture: tauri::State<'_, CaptureState>,
    url: String,
    body: String,
    headers: Vec<(String, String)>,
    method: Option<String>,
) -> Result<String, String> {
    // Use the shared rquest client (Chrome TLS fingerprint, persistent connection pool).
    let client = &capture.x_client;

    let req_builder = if method.as_deref() == Some("GET") {
        client.get(&url)
    } else {
        client.post(&url).body(body)
    };

    let mut request = req_builder;
    for (key, value) in headers {
        request = request.header(&key, &value);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("X API request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("X API error {}: {}", status, body));
    }

    response.text().await.map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tauri commands — sync
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_local_ip() -> Result<String, String> {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .map_err(|e| e.to_string())
}

/// Get all non-loopback IPv4 addresses with their interface names.
/// Useful for diagnosing cases where the primary IP is a VPN tunnel
/// rather than the Wi-Fi interface the phone is connected to.
#[tauri::command]
fn get_all_local_ips() -> Vec<serde_json::Value> {
    let port = sync_relay_port();
    match local_ip_address::list_afinet_netifas() {
        Ok(ifaces) => ifaces
            .into_iter()
            .filter(|(_, ip)| {
                // IPv4 only, skip loopback
                matches!(ip, std::net::IpAddr::V4(v4) if !v4.is_loopback())
            })
            .map(|(name, ip)| {
                serde_json::json!({
                    "interface": name,
                    "ip": ip.to_string(),
                    "url": format!("ws://{}:{}", ip, port),
                })
            })
            .collect(),
        Err(_) => vec![],
    }
}

/// Returns the full WebSocket pairing URL including the auth token.
///
/// Format: `ws://<lan-ip>:<port>?t=<base64url-token>`
///
/// This URL is encoded into the QR code shown in the Mobile Sync tab.
/// Only devices that scan the QR code (i.e. know the token) can connect.
#[tauri::command]
fn get_sync_url(state: tauri::State<'_, RelayState>) -> String {
    let port = state.port;
    // StdRwLock guard is held briefly and dropped before any await — safe.
    let token = state.pairing_token.read().unwrap().clone();
    let ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "localhost".to_string());
    format!("ws://{}:{}?t={}", ip, port, token)
}

/// Rotates the pairing token and persists the new value to disk.
///
/// In-flight connections are unaffected (they already authenticated).
/// New connection attempts with the old token will be rejected — devices
/// must rescan the QR code to reconnect.
#[tauri::command]
async fn reset_pairing_token(
    app: tauri::AppHandle,
    state: tauri::State<'_, RelayState>,
) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let new_token = generate_token();
    std::fs::write(data_dir.join("pairing-token"), &new_token).map_err(|e| e.to_string())?;
    *state.pairing_token.write().unwrap() = new_token.clone();
    info!("[Sync] Pairing token rotated");
    Ok(new_token)
}

#[tauri::command]
async fn get_sync_client_count(state: tauri::State<'_, RelayState>) -> Result<usize, String> {
    Ok(*state.client_count.read().await)
}

#[tauri::command]
async fn get_runtime_memory_stats(
    state: tauri::State<'_, RelayState>,
) -> Result<RuntimeMemoryStats, String> {
    let pid = Pid::from_u32(std::process::id());
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing().with_memory(),
    );

    let (process_resident_bytes, process_virtual_bytes) = system
        .process(pid)
        .map(|process| (process.memory(), process.virtual_memory()))
        .unwrap_or((0, 0));

    let relay_doc_bytes = state
        .current_doc
        .read()
        .await
        .as_ref()
        .map(|doc| doc.len() as u64)
        .unwrap_or(0);
    let relay_client_count = *state.client_count.read().await as u64;

    Ok(RuntimeMemoryStats {
        process_resident_bytes,
        process_virtual_bytes,
        relay_doc_bytes,
        relay_client_count,
    })
}

/// Push a document update to all connected clients.
#[cfg_attr(feature = "perf", tracing::instrument(skip(state, doc_bytes), fields(bytes = doc_bytes.len())))]
#[tauri::command]
async fn broadcast_doc(
    state: tauri::State<'_, RelayState>,
    doc_bytes: Vec<u8>,
) -> Result<(), String> {
    let doc_bytes = Arc::new(doc_bytes);
    *state.current_doc.write().await = Some(doc_bytes.clone());
    let _ = state.broadcast_tx.send(doc_bytes);
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — mDNS + snapshots
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_mdns_active(mdns: tauri::State<'_, MdnsState>) -> bool {
    mdns.0.is_some()
}

#[tauri::command]
fn list_snapshots(app: tauri::AppHandle) -> Vec<String> {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return vec![];
    };
    let dir = data_dir.join("snapshots");

    let mut entries: Vec<String> = std::fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            if name.starts_with("freed-") && name.ends_with(".automerge") {
                Some(name)
            } else {
                None
            }
        })
        .collect();

    entries.sort_unstable_by(|a, b| b.cmp(a)); // newest first
    entries
}

#[tauri::command]
fn get_recent_logs(app: tauri::AppHandle, limit: Option<usize>) -> Result<Vec<String>, String> {
    let limit = limit.unwrap_or(120).clamp(1, 1_000);
    let log_dir = match app.path().app_log_dir() {
        Ok(dir) => dir,
        Err(_) => return Ok(vec![]),
    };

    let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(&log_dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .collect();

    files.sort_by_key(|path| {
        std::fs::metadata(path)
            .and_then(|meta| meta.modified())
            .ok()
    });
    files.reverse();

    let mut lines = Vec::new();
    for path in files {
        let Ok(contents) = std::fs::read_to_string(&path) else {
            continue;
        };
        for line in contents.lines().rev() {
            if line.trim().is_empty() {
                continue;
            }
            lines.push(line.to_string());
            if lines.len() >= limit {
                lines.reverse();
                return Ok(lines);
            }
        }
    }

    lines.reverse();
    Ok(lines)
}

// ---------------------------------------------------------------------------
// Tauri commands — OAuth localhost server
// ---------------------------------------------------------------------------

/// Parse the OAuth callback request from the browser stream, emit the code to
/// the frontend, and respond with a success page so the user knows to close
/// the tab.
async fn handle_oauth_stream(stream: TcpStream, app: tauri::AppHandle) {
    let (reader_half, mut writer_half) = stream.into_split();
    let mut buf_reader = BufReader::new(reader_half);
    let mut request_line = String::new();
    if buf_reader.read_line(&mut request_line).await.is_err() {
        return;
    }

    // Parse `GET /callback?code=...&state=... HTTP/1.1`
    let path = request_line
        .split_whitespace()
        .nth(1)
        .unwrap_or("")
        .to_string();

    let query = path.splitn(2, '?').nth(1).unwrap_or("");
    let mut code = String::new();
    let mut state = String::new();

    // OAuth code and state values are URL-safe by spec (base64url / UUID), so
    // raw string splitting is sufficient — no percent-decoding needed.
    for pair in query.split('&') {
        if let Some(v) = pair.strip_prefix("code=") {
            code = v.to_string();
        } else if let Some(v) = pair.strip_prefix("state=") {
            state = v.to_string();
        }
    }

    let _ = app.emit(
        "cloud-oauth-code",
        serde_json::json!({ "code": code, "state": state }),
    );

    let body = "<html><body style='font-family:sans-serif;text-align:center;padding:4rem'>\
        <h2>Connected to Freed</h2>\
        <p>You can close this tab and return to the app.</p>\
        </body></html>";

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body,
    );

    let _ = writer_half.write_all(response.as_bytes()).await;
    let _ = writer_half.flush().await;
}

/// Spin up a one-shot HTTP server on a random localhost port to capture the
/// OAuth redirect from the system browser.
///
/// Returns the port immediately so the caller can construct the redirect URI
/// *before* launching the browser. Emits `cloud-oauth-code` with
/// `{ code: String, state: String }` when the callback arrives, then shuts
/// the server down. Times out after 5 minutes of waiting.
#[tauri::command]
async fn start_oauth_server(app: tauri::AppHandle) -> Result<u16, String> {
    // Bind to IPv4 loopback first to get a port, then also bind IPv6 loopback
    // on the same port so that browsers which resolve localhost → ::1 (common
    // on macOS) can still reach the callback server.
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    // Attempt IPv6 loopback on the same port — best-effort, not fatal if ::1 is
    // unavailable (e.g. IPv6 disabled system-wide).
    let listener6 = TcpListener::bind(format!("[::1]:{}", port)).await.ok();

    // Race both listeners — whichever receives the browser callback first wins.
    // The success response and the Tauri event are emitted from the winning task;
    // the other task is dropped once the oneshot fires.
    let (tx, rx) = tokio::sync::oneshot::channel::<TcpStream>();

    async fn accept_one(listener: TcpListener, tx: tokio::sync::oneshot::Sender<TcpStream>) {
        let accept = timeout(Duration::from_secs(300), listener.accept()).await;
        if let Ok(Ok((stream, _))) = accept {
            let _ = tx.send(stream);
        }
    }

    tokio::spawn(accept_one(listener, tx));
    if let Some(l6) = listener6 {
        // Spawn IPv6 acceptor with its own sender clone isn't possible for
        // oneshot, so we use a second oneshot and pick whichever fires.
        // Re-implement the race with a select instead.
        let (tx6, rx6) = tokio::sync::oneshot::channel::<TcpStream>();
        tokio::spawn(accept_one(l6, tx6));

        tokio::spawn(async move {
            let stream = tokio::select! {
                Ok(s) = rx  => s,
                Ok(s) = rx6 => s,
                else => {
                    error!("[OAuth] Both listeners timed out or errored");
                    return;
                }
            };
            handle_oauth_stream(stream, app).await;
        });
    } else {
        tokio::spawn(async move {
            let Ok(stream) = rx.await else {
                error!("[OAuth] Server timed out or failed to accept connection");
                return;
            };
            handle_oauth_stream(stream, app).await;
        });
    }

    Ok(port)
}

// ---------------------------------------------------------------------------
// Tauri commands — window
// ---------------------------------------------------------------------------

#[tauri::command]
fn show_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// ---------------------------------------------------------------------------
// Tauri commands — X login window
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(tag = "status")]
enum XLoginCheckResult {
    /// The login window is not open.
    #[serde(rename = "closed")]
    Closed,
    /// The window is open but session cookies are not yet available.
    #[serde(rename = "pending")]
    Pending,
    /// Both ct0 and auth_token are present.
    #[serde(rename = "ready")]
    Ready { ct0: String, auth_token: String },
}

/// Open a secondary WebView window pointing to X's login page.
/// If the window already exists, focus it instead of creating a duplicate.
#[tauri::command]
async fn open_x_login_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("x-login") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        "x-login",
        tauri::WebviewUrl::External("https://x.com/i/flow/login".parse().unwrap()),
    )
    .title("Sign in to X")
    .inner_size(480.0, 720.0)
    .center()
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Check whether the X login webview has session cookies available.
/// Returns a tagged result so the frontend can distinguish "window gone"
/// from "window open, still waiting for login."
#[tauri::command]
async fn check_x_login_cookies(app: tauri::AppHandle) -> Result<XLoginCheckResult, String> {
    let Some(window) = app.get_webview_window("x-login") else {
        return Ok(XLoginCheckResult::Closed);
    };

    let url: url::Url = "https://x.com".parse().unwrap();
    let cookies = window.cookies_for_url(url).map_err(|e| e.to_string())?;

    let ct0 = cookies
        .iter()
        .find(|c| c.name() == "ct0")
        .map(|c| c.value().to_string());
    let auth_token = cookies
        .iter()
        .find(|c| c.name() == "auth_token")
        .map(|c| c.value().to_string());

    match (ct0, auth_token) {
        (Some(ct0), Some(auth_token)) => Ok(XLoginCheckResult::Ready { ct0, auth_token }),
        _ => Ok(XLoginCheckResult::Pending),
    }
}

/// Close and destroy the X login window.
#[tauri::command]
async fn close_x_login_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("x-login") {
        window.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

/// Returns a random delay in milliseconds drawn from a Gaussian distribution
/// with the given mean and standard deviation. The result is clamped to a
/// minimum of 400ms so we never produce absurdly short pauses.
///
/// Uses the Box-Muller transform to convert two uniform samples to a normal
/// variate, which is fast and requires no external crate.
fn gaussian_ms(mean: f64, std_dev: f64) -> u64 {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let u1: f64 = rng.gen_range(f64::EPSILON..1.0);
    let u2: f64 = rng.gen_range(0.0..1.0);
    let z = (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos();
    (mean + z * std_dev).max(400.0) as u64
}

// ---------------------------------------------------------------------------
// Tauri commands — Facebook WebView scraper
// ---------------------------------------------------------------------------

/// The extraction script injected into the Facebook WebView after page load.
/// Reads posts from the rendered DOM and emits them via Tauri event IPC.
///
/// This is a self-contained script with no external dependencies.
/// It runs inside facebook.com's execution context.
const FB_EXTRACT_SCRIPT: &str = include_str!("fb-extract.js");
const FB_GROUPS_EXTRACT_SCRIPT: &str = include_str!("fb-groups-extract.js");
const FB_STORIES_EXTRACT_SCRIPT: &str = include_str!("fb-stories-extract.js");

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct FbGroupInfoPayload {
    id: String,
    name: String,
    url: String,
}

#[derive(Debug, serde::Deserialize)]
struct FbGroupsDataPayload {
    groups: Vec<FbGroupInfoPayload>,
    error: Option<String>,
}

/// Show a visible WebView window navigated to facebook.com/login so the
/// user can authenticate through the real Facebook login flow.
///
/// The window reuses the "fb-scraper" label. If it already exists it is
/// shown and focused; otherwise a new window is created.
///
/// An `on_navigation` handler detects when the user completes login
/// (URL leaves /login) and auto-hides the window + emits `fb-auth-result`.
#[tauri::command]
async fn fb_show_login(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
    user_agent: String,
) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    if let Some(existing) = app.get_webview_window("fb-scraper") {
        let _ = set_background_scraper_window_cloak(&existing, false);
        let _ = set_background_scraper_media_guard(&existing, false);
        existing
            .navigate("https://www.facebook.com/login".parse().unwrap())
            .map_err(|e| e.to_string())?;
        let _ = existing.show();
        let _ = existing.set_focus();
        // Update the stored UA in case it changed since last connect.
        *capture.fb_user_agent.lock().unwrap() = user_agent;
        return Ok(());
    }

    let app_handle = app.clone();
    let auth_emitted = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    WebviewWindowBuilder::new(
        &app,
        "fb-scraper",
        tauri::WebviewUrl::External("https://www.facebook.com/login".parse().unwrap()),
    )
    .user_agent(&user_agent)
    .initialization_script(include_str!("webkit-mask.js"))
    .title("Connect Facebook — Freed")
    .inner_size(
        460.0 + {
            use rand::Rng;
            rand::thread_rng().gen_range(-8.0f64..8.0)
        },
        700.0 + {
            use rand::Rng;
            rand::thread_rng().gen_range(-10.0f64..10.0)
        },
    )
    .center()
    .visible(true)
    .on_navigation(move |url| {
        let path = url.path();
        let host = url.host_str().unwrap_or("");

        // Detect successful login: navigated away from /login on a facebook domain
        if host.contains("facebook.com")
            && path != "/login"
            && path != "/login/"
            && !auth_emitted.swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            if let Some(w) = app_handle.get_webview_window("fb-scraper") {
                let _ = w.hide();
            }
            let _ = app_handle.emit("fb-auth-result", serde_json::json!({ "loggedIn": true }));
            schedule_webview_recycle(
                app_handle.clone(),
                "fb-scraper",
                "login complete",
                Duration::from_secs(2),
            );
        }

        true
    })
    .build()
    .map_err(|e| e.to_string())?;

    *capture.fb_user_agent.lock().unwrap() = user_agent;

    Ok(())
}

/// Hide the Facebook login window after successful authentication.
#[tauri::command]
async fn fb_hide_login(app: tauri::AppHandle) -> Result<(), String> {
    recycle_webview_window(&app, "fb-scraper", "login dismissed");
    Ok(())
}

/// Check whether the Facebook WebView has an authenticated session.
///
/// Creates a hidden WebView if none exists, navigates to facebook.com,
/// waits for the page to settle, then checks for logged-in indicators
/// (USER_ID != "0" in the page source).
#[tauri::command]
async fn fb_check_auth(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
) -> Result<bool, String> {
    use tauri::WebviewWindowBuilder;

    let scraper_user_agent = stored_or_default_user_agent(&capture.fb_user_agent);
    let _scraper_session = acquire_background_scraper_session(&capture, "fb_check_auth").await;
    let _recycle_guard = WebviewRecycleGuard::new(app.clone(), "fb-scraper", "auth check");
    let wv = match app.get_webview_window("fb-scraper") {
        Some(w) => w,
        None => WebviewWindowBuilder::new(
            &app,
            "fb-scraper",
            tauri::WebviewUrl::External("https://www.facebook.com/".parse().unwrap()),
        )
        .user_agent(&scraper_user_agent)
        .initialization_script(include_str!("webkit-mask.js"))
        .initialization_script(INITIALIZE_BACKGROUND_SCRAPER_MEDIA_GUARD_JS)
        .title("Freed Facebook")
        .inner_size(460.0, 700.0)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?,
    };
    set_background_scraper_media_guard(&wv, true)?;

    tokio::time::sleep(Duration::from_secs(6)).await;

    wv.eval(
        r#"
        (function() {
            try {
                var loggedIn = document.cookie.indexOf('c_user=') !== -1
                    && document.cookie.indexOf('c_user=0') === -1;
                window.__TAURI__.event.emit('fb-auth-result', { loggedIn: loggedIn });
            } catch(e) {
                window.__TAURI__.event.emit('fb-auth-result', { loggedIn: false, error: e.message });
            }
        })();
        "#,
    )
    .map_err(|e| e.to_string())?;

    tokio::time::sleep(Duration::from_millis(250)).await;

    // The result is delivered asynchronously via event. The frontend
    // listens for 'fb-auth-result'. For the command return value we
    // fall back to a cookie-based heuristic checked from Rust.
    // Since we can't get eval() return values, we return a best-guess
    // and let the frontend reconcile via the event.
    Ok(true)
}

// ---------------------------------------------------------------------------
// Story navigation helpers
// ---------------------------------------------------------------------------

/// Navigate through up to `max_frames` Facebook story frames, injecting the
/// story extraction script after each frame becomes visible.
///
/// Clicks the first story card in the story tray carousel to enter the viewer,
/// then advances through frames by clicking the right-side navigation area.
/// Uses Gaussian delays between frames to mimic natural viewing pace.
///
/// Bails early if the story viewer closes (overlay no longer present) or
/// if `max_frames` have been viewed.
async fn scrape_fb_stories(wv: &tauri::WebviewWindow, max_frames: usize) {
    use rand::Rng;

    let _ = set_background_scraper_media_guard(wv, true);
    info!("[FB] story scrape start, max_frames={}", max_frames);

    // Click the first story card at the top of the News Feed. Facebook renders
    // story cards as a horizontal carousel above the feed. The first non-"Your Story"
    // card is typically a friend's story.
    let click_first_story = r#"
        (function() {
            // Story tray items: a[href*="/stories/"] links or cards with role="button"
            var links = document.querySelectorAll('a[href*="/stories/"]');
            for (var i = 0; i < links.length; i++) {
                var href = links[i].href || '';
                // Skip "your own story" (facebook.com/stories/me or /stories/create)
                if (!href.includes('/stories/me') && !href.includes('/stories/create') && !href.includes('add_story')) {
                    links[i].click();
                    return true;
                }
            }
            // Fallback: story ring elements (div with circular avatar in the tray)
            var rings = document.querySelectorAll('[aria-label*="story"], [aria-label*="Story"]');
            for (var j = 0; j < rings.length; j++) {
                var label = rings[j].getAttribute('aria-label') || '';
                if (!label.toLowerCase().includes('your story') && !label.toLowerCase().includes('add story')) {
                    rings[j].click();
                    return true;
                }
            }
            return false;
        })();
    "#;

    // eval() returns Ok(()) if the JS injection succeeded, regardless of
    // whether the JS actually found a story to click. We can't retrieve
    // JS return values from WebView. This guard only catches injection
    // failures (e.g. WebView not ready); a missing story tray is handled
    // gracefully by the frame loop emitting empty results.
    let eval_ok = wv.eval(click_first_story).is_ok();
    if !eval_ok {
        println!("[FB] story tray eval injection failed, skipping story scrape");
        return;
    }

    // Wait for story viewer to open
    tokio::time::sleep(Duration::from_millis(gaussian_ms(2500.0, 400.0))).await;

    for frame in 0..max_frames {
        // Inject story extraction script
        if let Err(e) = wv.eval(FB_STORIES_EXTRACT_SCRIPT) {
            println!("[FB] story extract inject failed at frame {}: {}", frame, e);
            break;
        }

        // Pause to let the user "view" this story frame (2-4s normally, ~8% chance of 6-8s)
        let view_pause = if rand::thread_rng().gen_bool(0.08) {
            gaussian_ms(7000.0, 1000.0)
        } else {
            gaussian_ms(3000.0, 700.0)
        };
        tokio::time::sleep(Duration::from_millis(view_pause)).await;

        println!("[FB] story frame {} extracted", frame + 1);

        // We can't get eval return values back from WebView, so we advance
        // until we hit the frame cap or the injection fails.
        if frame + 1 >= max_frames {
            break;
        }

        // Click the "Next story" area — right side of the viewer
        let next_js = r#"
            (function() {
                // Explicit next button
                var next = document.querySelector('[aria-label="Next story"]') ||
                           document.querySelector('[aria-label="Next"]') ||
                           document.querySelector('[aria-label="next"]');
                if (next) { next.click(); return; }
                // Click the right 20% of the viewport (tap-to-advance area)
                var x = Math.floor(window.innerWidth * 0.82);
                var y = Math.floor(window.innerHeight * 0.5);
                document.elementFromPoint(x, y)?.click();
            })();
        "#;
        let _ = wv.eval(next_js);

        // Brief pause after advancing to let the next frame load
        tokio::time::sleep(Duration::from_millis(gaussian_ms(1200.0, 300.0))).await;
    }

    // Close the story viewer by pressing Escape or clicking the X button
    let close_js = r#"
        (function() {
            var closeBtn = document.querySelector('[aria-label="Close"]') ||
                           document.querySelector('[aria-label="close"]');
            if (closeBtn) { closeBtn.click(); return; }
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        })();
    "#;
    let _ = wv.eval(close_js);
    tokio::time::sleep(Duration::from_millis(800)).await;

    println!("[FB] story scrape complete");
}

/// Navigate through up to `max_frames` Instagram story frames, injecting the
/// story extraction script after each frame becomes visible.
///
/// Clicks the first story avatar in the Instagram stories tray (the horizontal
/// row of circular avatars at the top of the Following feed), then advances
/// through frames using the right-side click area.
async fn scrape_ig_stories(wv: &tauri::WebviewWindow, max_frames: usize) {
    use rand::Rng;

    let _ = set_background_scraper_media_guard(wv, true);
    info!("[IG] story scrape start, max_frames={}", max_frames);

    // Click the first friend's story avatar in the top tray.
    // Instagram story trays are anchors linking to /stories/<username>/
    let click_first_story = r#"
        (function() {
            var links = document.querySelectorAll('a[href*="/stories/"]');
            for (var i = 0; i < links.length; i++) {
                var href = links[i].href || '';
                // Skip own story (highlight reels end with a numeric id, not /create/)
                if (!href.includes('/stories/create') && !href.includes('highlight')) {
                    links[i].click();
                    return true;
                }
            }
            // Fallback: canvas-based story ring buttons
            var btns = document.querySelectorAll('button[aria-label*="story"], button[aria-label*="Story"]');
            for (var j = 0; j < btns.length; j++) {
                btns[j].click();
                return true;
            }
            return false;
        })();
    "#;

    // eval() returns Ok(()) if the JS injection succeeded, regardless of
    // whether the JS actually found a story to click. We can't retrieve
    // JS return values from WebView. This guard only catches injection
    // failures (e.g. WebView not ready); a missing story tray is handled
    // gracefully by the frame loop emitting empty results.
    let eval_ok = wv.eval(click_first_story).is_ok();
    if !eval_ok {
        println!("[IG] story tray eval injection failed, skipping story scrape");
        return;
    }

    // Wait for the story viewer overlay to open
    tokio::time::sleep(Duration::from_millis(gaussian_ms(2200.0, 400.0))).await;

    for frame in 0..max_frames {
        // Inject story extraction script
        if let Err(e) = wv.eval(IG_STORIES_EXTRACT_SCRIPT) {
            println!("[IG] story extract inject failed at frame {}: {}", frame, e);
            break;
        }

        // "View" pause: 2-4s normally, ~8% chance of 6-8s (lingering on a story)
        let view_pause = if rand::thread_rng().gen_bool(0.08) {
            gaussian_ms(7000.0, 1000.0)
        } else {
            gaussian_ms(3000.0, 600.0)
        };
        tokio::time::sleep(Duration::from_millis(view_pause)).await;

        println!("[IG] story frame {} extracted", frame + 1);

        if frame + 1 >= max_frames {
            break;
        }

        // Advance to next story frame by clicking the right side of the viewer
        let next_js = r#"
            (function() {
                // Explicit next button (Instagram uses SVG arrow buttons)
                var next = document.querySelector('[aria-label="Next"]') ||
                           document.querySelector('button[aria-label*="next"]') ||
                           document.querySelector('button[aria-label*="Next"]');
                if (next) { next.click(); return; }
                // Click the right 80% x / 50% y of the viewport
                var x = Math.floor(window.innerWidth * 0.80);
                var y = Math.floor(window.innerHeight * 0.5);
                var el = document.elementFromPoint(x, y);
                if (el) el.click();
            })();
        "#;
        let _ = wv.eval(next_js);

        tokio::time::sleep(Duration::from_millis(gaussian_ms(1000.0, 250.0))).await;
    }

    // Close the story viewer
    let close_js = r#"
        (function() {
            var closeBtn = document.querySelector('[aria-label="Close"]') ||
                           document.querySelector('button[aria-label*="Close"]');
            if (closeBtn) { closeBtn.click(); return; }
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        })();
    "#;
    let _ = wv.eval(close_js);
    tokio::time::sleep(Duration::from_millis(800)).await;

    println!("[IG] story scrape complete");
}

/// Trigger a feed scrape in the Facebook WebView.
///
/// Navigates to facebook.com, waits for content to render, then injects
/// the extraction script which reads the DOM and emits 'fb-feed-data'.
///
/// `window_mode` controls visibility during scraping:
/// - `shown`: window is centered and visible during sync.
/// - `cloaked`: window stays visible for WebKit but is transparent and click-through.
/// - `hidden`: window is fully hidden, which is quieter but can be less reliable.
#[tauri::command]
async fn fb_scrape_feed(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
    window_mode: ScraperWindowMode,
) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    let fb_feed_url = "https://www.facebook.com/";
    let scraper_user_agent = stored_or_default_user_agent(&capture.fb_user_agent);
    let _scraper_session = acquire_background_scraper_session(&capture, "fb_scrape_feed").await;
    let _recycle_guard =
        WebviewRecycleGuard::new(app.clone(), "fb-scraper", "feed scrape complete");

    let wv = match app.get_webview_window("fb-scraper") {
        Some(w) => {
            prepare_background_scraper_window(&w, window_mode)?;
            w.navigate(fb_feed_url.parse().unwrap())
                .map_err(|e| e.to_string())?;
            w
        }
        None => {
            let app_handle = app.clone();
            let mut builder = WebviewWindowBuilder::new(
                &app,
                "fb-scraper",
                tauri::WebviewUrl::External(fb_feed_url.parse().unwrap()),
            )
            .user_agent(&scraper_user_agent)
            .transparent(true)
            .initialization_script(include_str!("webkit-mask.js"))
            .initialization_script(INITIALIZE_BACKGROUND_SCRAPER_MEDIA_GUARD_JS)
            .title("Freed Facebook")
            .inner_size(1280.0, 900.0)
            .on_navigation(move |url| {
                let host = url.host_str().unwrap_or("");
                let path = url.path();
                if host.contains("facebook.com") && path != "/login" && path != "/login/" {
                    let _ =
                        app_handle.emit("fb-auth-result", serde_json::json!({ "loggedIn": true }));
                }
                true
            });

            if window_mode == ScraperWindowMode::Shown {
                builder = builder.center().visible(true);
            } else if window_mode == ScraperWindowMode::Cloaked {
                builder = builder
                    .focused(false)
                    .focusable(false)
                    .decorations(false)
                    .always_on_bottom(true)
                    .skip_taskbar(true)
                    .shadow(false)
                    .initialization_script(INITIALIZE_BACKGROUND_SCRAPER_CLOAK_JS)
                    .visible(true);
            } else {
                builder = builder
                    .focused(false)
                    .focusable(false)
                    .decorations(false)
                    .always_on_bottom(true)
                    .skip_taskbar(true)
                    .shadow(false)
                    .visible(false);
            }

            builder.build().map_err(|e| e.to_string())?
        }
    };

    info!(
        "[FB] scrape started (window_mode={}), waiting for page load...",
        window_mode.as_str()
    );

    tokio::time::sleep(Duration::from_millis(gaussian_ms(13000.0, 1500.0))).await;

    wv.eval(
        r#"
        (function() {
            if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.emit) {
                window.__TAURI__.event.emit('fb-diag', {
                    userAgent: navigator.userAgent,
                    url: window.location.href,
                    title: document.title,
                    scrollHeight: document.documentElement.scrollHeight,
                });
            }
        })();
    "#,
    )
    .map_err(|e| e.to_string())?;
    tokio::time::sleep(Duration::from_millis(300)).await;

    // Randomized ordering: ~50% stories-first, ~50% feed-first.
    // ~15% chance to skip story scraping entirely (real users don't always check stories).
    let skip_stories = {
        use rand::Rng;
        rand::thread_rng().gen_bool(0.15)
    };
    let stories_first = !skip_stories && {
        use rand::Rng;
        rand::thread_rng().gen_bool(0.50)
    };
    let story_frame_cap = {
        use rand::Rng;
        rand::thread_rng().gen_range(4usize..=8)
    };

    if stories_first {
        println!("[FB] coin flip: stories FIRST");
        scrape_fb_stories(&wv, story_frame_cap).await;
        restore_scraper_feed(&wv, fb_feed_url, "FB").await?;
    } else if skip_stories {
        println!("[FB] skipping story scrape this session (~15% chance)");
    } else {
        println!("[FB] coin flip: feed FIRST, stories after initial passes");
    }

    // Facebook virtualizes its feed: posts only exist in the DOM when
    // they're near the viewport, and are unmounted when scrolled away.
    // We must scroll incrementally, extracting at each position.
    let num_passes = {
        use rand::Rng;
        rand::thread_rng().gen_range(8usize..=18)
    };
    // If doing feed-first, split the passes: 2-4 passes before stories, rest after.
    let early_passes = if !stories_first && !skip_stories {
        use rand::Rng;
        rand::thread_rng().gen_range(2usize..=4)
    } else {
        num_passes // all passes in one go
    };

    for i in 0..num_passes {
        prepare_background_scraper_window(&wv, window_mode)?;

        wv.eval(FB_EXTRACT_SCRIPT)
            .map_err(|e| format!("Failed to inject extraction script: {}", e))?;

        tokio::time::sleep(Duration::from_millis(300)).await;

        let scroll_amount = {
            use rand::Rng;
            rand::thread_rng().gen_range(280u64..520)
        };
        let scroll_js = format!(
            "window.scrollBy({{ top: {}, behavior: 'smooth' }});",
            scroll_amount
        );
        wv.eval(&scroll_js).map_err(|e| e.to_string())?;

        // Inject mouse movement before scrolling (mimics real user pointer activity).
        let cx = 230 + {
            use rand::Rng;
            rand::thread_rng().gen_range(0i32..200)
        };
        let cy = 350 + {
            use rand::Rng;
            rand::thread_rng().gen_range(0i32..200)
        };
        let mouse_js = format!(
            r#"(function(){{var x={cx},y={cy};[0,1,2].forEach(function(i){{setTimeout(function(){{document.dispatchEvent(new MouseEvent('mousemove',{{clientX:x+i*12,clientY:y+i*8,bubbles:true,cancelable:true}}));}},i*80);}});}})();"#,
            cx = cx,
            cy = cy
        );
        let _ = wv.eval(&mouse_js);
        tokio::time::sleep(Duration::from_millis(gaussian_ms(280.0, 60.0))).await;

        // Occasional micro-backscroll (~12% probability) simulates re-reading.
        if {
            use rand::Rng;
            rand::thread_rng().gen_bool(0.12)
        } {
            let back = {
                use rand::Rng;
                rand::thread_rng().gen_range(80u64..250)
            };
            let back_js = format!("window.scrollBy({{top: -{}, behavior: 'smooth'}});", back);
            let _ = wv.eval(&back_js);
            tokio::time::sleep(Duration::from_millis(gaussian_ms(600.0, 150.0))).await;
        }

        // Gaussian pause between scroll passes; ~25% chance of a longer "reading" pause.
        let pause = if {
            use rand::Rng;
            rand::thread_rng().gen_bool(0.25)
        } {
            gaussian_ms(6000.0, 1500.0)
        } else {
            gaussian_ms(2750.0, 600.0)
        };
        tokio::time::sleep(Duration::from_millis(pause)).await;

        info!(
            "[FB] pass {}/{}: scrolled +{}px",
            i + 1,
            num_passes,
            scroll_amount
        );

        // Feed-first ordering: after early_passes, scroll back to top and scrape stories
        if !stories_first && !skip_stories && i + 1 == early_passes {
            info!(
                "[FB] interleaving story scrape after {} feed passes",
                early_passes
            );
            let _ = wv.eval("window.scrollTo({ top: 0, behavior: 'smooth' });");
            tokio::time::sleep(Duration::from_millis(gaussian_ms(1800.0, 400.0))).await;
            scrape_fb_stories(&wv, story_frame_cap).await;
            restore_scraper_feed(&wv, fb_feed_url, "FB").await?;
        }
    }

    wv.eval(FB_EXTRACT_SCRIPT)
        .map_err(|e| format!("Failed to inject extraction script: {}", e))?;

    tokio::time::sleep(Duration::from_millis(500)).await;
    info!(
        "[FB] scrape complete, {} extraction passes emitted",
        num_passes + 1
    );

    Ok(())
}

#[tauri::command]
async fn fb_scrape_groups(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
    window_mode: ScraperWindowMode,
) -> Result<Vec<FbGroupInfoPayload>, String> {
    use tauri::WebviewWindowBuilder;

    let fb_groups_url = "https://www.facebook.com/groups/?category=joined";
    let scraper_user_agent = stored_or_default_user_agent(&capture.fb_user_agent);
    let _scraper_session = acquire_background_scraper_session(&capture, "fb_scrape_groups").await;
    let _recycle_guard =
        WebviewRecycleGuard::new(app.clone(), "fb-scraper", "groups scrape complete");

    let wv = match app.get_webview_window("fb-scraper") {
        Some(w) => {
            prepare_background_scraper_window(&w, window_mode)?;
            w.navigate(fb_groups_url.parse().unwrap())
                .map_err(|e| e.to_string())?;
            w
        }
        None => {
            let app_handle = app.clone();
            let mut builder = WebviewWindowBuilder::new(
                &app,
                "fb-scraper",
                tauri::WebviewUrl::External(fb_groups_url.parse().unwrap()),
            )
            .user_agent(&scraper_user_agent)
            .initialization_script(include_str!("webkit-mask.js"))
            .initialization_script(INITIALIZE_BACKGROUND_SCRAPER_MEDIA_GUARD_JS)
            .title("Freed Facebook")
            .inner_size(1280.0, 900.0)
            .on_navigation(move |url| {
                let host = url.host_str().unwrap_or("");
                let path = url.path();
                if host.contains("facebook.com") && path != "/login" && path != "/login/" {
                    let _ =
                        app_handle.emit("fb-auth-result", serde_json::json!({ "loggedIn": true }));
                }
                true
            });

            if window_mode == ScraperWindowMode::Shown {
                builder = builder.center().visible(true);
            } else if window_mode == ScraperWindowMode::Cloaked {
                builder = builder
                    .transparent(true)
                    .focused(false)
                    .focusable(false)
                    .decorations(false)
                    .always_on_bottom(true)
                    .skip_taskbar(true)
                    .shadow(false)
                    .initialization_script(INITIALIZE_BACKGROUND_SCRAPER_CLOAK_JS)
                    .visible(true);
            } else {
                builder = builder
                    .focused(false)
                    .focusable(false)
                    .decorations(false)
                    .always_on_bottom(true)
                    .skip_taskbar(true)
                    .shadow(false)
                    .visible(false);
            }

            builder.build().map_err(|e| e.to_string())?
        }
    };

    tokio::time::sleep(Duration::from_millis(gaussian_ms(3500.0, 500.0))).await;

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<FbGroupInfoPayload>, String>>();
    let tx = Arc::new(std::sync::Mutex::new(Some(tx)));
    let listener_tx = tx.clone();
    let listener_id = app.listen("fb-groups-data", move |event| {
        let result = serde_json::from_str::<FbGroupsDataPayload>(event.payload())
            .map_err(|err| err.to_string())
            .and_then(|payload| {
                if let Some(error) = payload.error {
                    Err(error)
                } else {
                    Ok(payload.groups)
                }
            });

        if let Some(sender) = listener_tx.lock().unwrap().take() {
            let _ = sender.send(result);
        }
    });

    wv.eval(FB_GROUPS_EXTRACT_SCRIPT)
        .map_err(|e| format!("Failed to inject groups extraction script: {}", e))?;

    let groups = match timeout(Duration::from_secs(10), rx).await {
        Ok(Ok(result)) => result?,
        Ok(Err(_)) => Err("Groups scrape channel closed".to_string())?,
        Err(_) => Err("Groups scrape timed out after 10 seconds".to_string())?,
    };

    app.unlisten(listener_id);
    Ok(groups)
}

/// Disconnect Facebook by clearing all browsing data in the scraper WebView.
#[tauri::command]
async fn fb_disconnect(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview_window("fb-scraper") {
        wv.clear_all_browsing_data().map_err(|e| e.to_string())?;
        let _ = wv.destroy();
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — Instagram WebView scraper
// ---------------------------------------------------------------------------

/// The extraction script injected into the Instagram WebView after page load.
/// Reads posts from the rendered DOM and emits them via Tauri event IPC.
const IG_EXTRACT_SCRIPT: &str = include_str!("ig-extract.js");
const IG_STORIES_EXTRACT_SCRIPT: &str = include_str!("ig-stories-extract.js");

/// Show a visible WebView window navigated to instagram.com/accounts/login
/// so the user can authenticate through the real Instagram login flow.
///
/// An `on_navigation` handler detects when the user completes login
/// (URL leaves /accounts/login) and auto-hides the window + emits
/// `ig-auth-result`.
#[tauri::command]
async fn ig_show_login(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
    user_agent: String,
) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    if let Some(existing) = app.get_webview_window("ig-scraper") {
        let _ = set_background_scraper_window_cloak(&existing, false);
        let _ = set_background_scraper_media_guard(&existing, false);
        existing
            .navigate("https://www.instagram.com/accounts/login/".parse().unwrap())
            .map_err(|e| e.to_string())?;
        let _ = existing.show();
        let _ = existing.set_focus();
        *capture.ig_user_agent.lock().unwrap() = user_agent;
        return Ok(());
    }

    let app_handle = app.clone();
    // Track whether we've already emitted the auth result (one-shot)
    let auth_emitted = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    WebviewWindowBuilder::new(
        &app,
        "ig-scraper",
        tauri::WebviewUrl::External("https://www.instagram.com/accounts/login/".parse().unwrap()),
    )
    .user_agent(&user_agent)
    .initialization_script(include_str!("webkit-mask.js"))
    .title("Connect Instagram — Freed")
    .inner_size(
        460.0 + {
            use rand::Rng;
            rand::thread_rng().gen_range(-8.0f64..8.0)
        },
        700.0 + {
            use rand::Rng;
            rand::thread_rng().gen_range(-10.0f64..10.0)
        },
    )
    .center()
    .visible(true)
    .on_navigation(move |url| {
        let path = url.path();
        let host = url.host_str().unwrap_or("");

        // Detect successful login: navigated away from /accounts/login on instagram.
        // Only fire once — don't hide again on subsequent navigations during scraping.
        if host.contains("instagram.com")
            && path != "/accounts/login"
            && path != "/accounts/login/"
            && !auth_emitted.swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            // Hide the login UI while the post-login scrape spins up.
            // ig_scrape_feed now recycles the WebView when the scrape ends.
            if let Some(w) = app_handle.get_webview_window("ig-scraper") {
                let _ = w.hide();
            }
            let _ = app_handle.emit("ig-auth-result", serde_json::json!({ "loggedIn": true }));

            // Auto-trigger a scrape shortly after login so the user doesn't need
            // to manually click "Sync Now".
            let scrape_app = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                info!("[IG] login detected, auto-scraping...");
                tokio::time::sleep(Duration::from_millis(gaussian_ms(4000.0, 800.0))).await;
                let capture = scrape_app.state::<CaptureState>();
                // Post-login auto-scrapes default to cloaked mode so they stay
                // out of the way without reintroducing hidden-window stalls.
                match ig_scrape_feed(scrape_app.clone(), capture, ScraperWindowMode::Cloaked).await
                {
                    Ok(()) => info!("[IG] post-login auto-scrape complete"),
                    Err(e) => info!("[IG] post-login auto-scrape error: {}", e),
                }
            });
        }

        true
    })
    .build()
    .map_err(|e| e.to_string())?;

    *capture.ig_user_agent.lock().unwrap() = user_agent;

    Ok(())
}

/// Hide the Instagram login window after successful authentication.
#[tauri::command]
async fn ig_hide_login(app: tauri::AppHandle) -> Result<(), String> {
    recycle_webview_window(&app, "ig-scraper", "login dismissed");
    Ok(())
}

/// Check whether the Instagram WebView has an authenticated session.
///
/// Creates a hidden WebView if none exists, navigates to instagram.com,
/// waits for the page to settle, then checks for the sessionid cookie.
#[tauri::command]
async fn ig_check_auth(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
) -> Result<bool, String> {
    use tauri::WebviewWindowBuilder;

    let scraper_user_agent = stored_or_default_user_agent(&capture.ig_user_agent);
    let _scraper_session = acquire_background_scraper_session(&capture, "ig_check_auth").await;
    let _recycle_guard = WebviewRecycleGuard::new(app.clone(), "ig-scraper", "auth check");
    let wv = match app.get_webview_window("ig-scraper") {
        Some(w) => w,
        None => WebviewWindowBuilder::new(
            &app,
            "ig-scraper",
            tauri::WebviewUrl::External("https://www.instagram.com/".parse().unwrap()),
        )
        .user_agent(&scraper_user_agent)
        .initialization_script(include_str!("webkit-mask.js"))
        .initialization_script(INITIALIZE_BACKGROUND_SCRAPER_MEDIA_GUARD_JS)
        .title("Freed Instagram")
        .inner_size(460.0, 700.0)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?,
    };
    set_background_scraper_media_guard(&wv, true)?;

    tokio::time::sleep(Duration::from_secs(6)).await;

    wv.eval(
        r#"
        (function() {
            try {
                var loggedIn = document.cookie.indexOf('sessionid=') !== -1
                    && document.cookie.indexOf('sessionid=;') === -1;
                window.__TAURI__.event.emit('ig-auth-result', { loggedIn: loggedIn });
            } catch(e) {
                window.__TAURI__.event.emit('ig-auth-result', { loggedIn: false, error: e.message });
            }
        })();
        "#,
    )
    .map_err(|e| e.to_string())?;

    tokio::time::sleep(Duration::from_millis(250)).await;

    Ok(true)
}

/// Trigger a feed scrape in the hidden Instagram WebView.
///
/// Navigates to instagram.com, waits for content to render, then injects
/// the extraction script which reads the DOM and emits 'ig-feed-data'.
///
/// `window_mode` controls visibility during scraping:
/// - `shown`: window is centered and visible during sync.
/// - `cloaked`: window stays visible for WebKit but is transparent and click-through.
/// - `hidden`: window is fully hidden, which is quieter but can be less reliable.
#[tauri::command]
async fn ig_scrape_feed(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
    window_mode: ScraperWindowMode,
) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    let ig_feed_url = "https://www.instagram.com/?variant=following";
    let scraper_user_agent = stored_or_default_user_agent(&capture.ig_user_agent);
    let _scraper_session = acquire_background_scraper_session(&capture, "ig_scrape_feed").await;
    let _recycle_guard =
        WebviewRecycleGuard::new(app.clone(), "ig-scraper", "feed scrape complete");

    let wv = match app.get_webview_window("ig-scraper") {
        Some(w) => {
            // Window exists (user already logged in).
            // DO NOT re-navigate - that would fire the ig_show_login on_navigation
            // callback which hides the window.
            prepare_background_scraper_window(&w, window_mode)?;
            info!(
                "[IG] reusing existing ig-scraper window (window_mode={})",
                window_mode.as_str()
            );
            w
        }
        None => {
            // No existing window - create one. This path runs on first-ever scrape
            // (when the user hasn't gone through ig_show_login yet, e.g. auto-scrape).
            let app_handle = app.clone();
            let mut builder = WebviewWindowBuilder::new(
                &app,
                "ig-scraper",
                tauri::WebviewUrl::External(ig_feed_url.parse().unwrap()),
            )
            .user_agent(&scraper_user_agent)
            .transparent(true)
            .initialization_script(include_str!("webkit-mask.js"))
            .initialization_script(INITIALIZE_BACKGROUND_SCRAPER_MEDIA_GUARD_JS)
            .title("Freed Instagram")
            .inner_size(1280.0, 900.0)
            .on_navigation(move |url| {
                let path = url.path();
                let host = url.host_str().unwrap_or("");
                if host.contains("instagram.com")
                    && (path == "/accounts/login" || path == "/accounts/login/")
                {
                    // Still on login — do nothing
                } else if host.contains("instagram.com") {
                    let _ =
                        app_handle.emit("ig-auth-result", serde_json::json!({ "loggedIn": true }));
                }
                true
            });

            if window_mode == ScraperWindowMode::Shown {
                builder = builder.center().visible(true);
            } else if window_mode == ScraperWindowMode::Cloaked {
                builder = builder
                    .focused(false)
                    .focusable(false)
                    .decorations(false)
                    .always_on_bottom(true)
                    .skip_taskbar(true)
                    .shadow(false)
                    .initialization_script(INITIALIZE_BACKGROUND_SCRAPER_CLOAK_JS)
                    .visible(true);
            } else {
                builder = builder
                    .focused(false)
                    .focusable(false)
                    .decorations(false)
                    .always_on_bottom(true)
                    .skip_taskbar(true)
                    .shadow(false)
                    .visible(false);
            }

            builder.build().map_err(|e| e.to_string())?
        }
    };

    info!(
        "[IG] scrape started (window_mode={}), waiting for feed to render...",
        window_mode.as_str()
    );

    tokio::time::sleep(Duration::from_millis(gaussian_ms(9000.0, 1200.0))).await;

    info!("[IG] waiting for feed to render, proceeding with extraction");

    // Belt-and-suspenders: click the Following tab if present
    let _ = wv.eval(r#"document.querySelector('a[href="/?variant=following"]')?.click();"#);
    tokio::time::sleep(Duration::from_millis(2000)).await;

    // Randomized ordering: ~50% stories-first, ~50% feed-first.
    // ~15% chance to skip story scraping entirely.
    let skip_stories = {
        use rand::Rng;
        rand::thread_rng().gen_bool(0.15)
    };
    let stories_first = !skip_stories && {
        use rand::Rng;
        rand::thread_rng().gen_bool(0.50)
    };
    let story_frame_cap = {
        use rand::Rng;
        rand::thread_rng().gen_range(4usize..=8)
    };

    if stories_first {
        println!("[IG] coin flip: stories FIRST");
        scrape_ig_stories(&wv, story_frame_cap).await;
        restore_scraper_feed(&wv, ig_feed_url, "IG").await?;
    } else if skip_stories {
        println!("[IG] skipping story scrape this session (~15% chance)");
    } else {
        println!("[IG] coin flip: feed FIRST, stories after initial passes");
    }

    // Instagram virtualizes its feed similarly to Facebook. Scroll
    // incrementally, extracting at each position.
    let num_passes = {
        use rand::Rng;
        rand::thread_rng().gen_range(7usize..=14)
    };
    // Feed-first: scrape stories after the first 2-4 passes
    let early_passes = if !stories_first && !skip_stories {
        use rand::Rng;
        rand::thread_rng().gen_range(2usize..=4)
    } else {
        num_passes
    };

    for i in 0..num_passes {
        prepare_background_scraper_window(&wv, window_mode)?;

        wv.eval(IG_EXTRACT_SCRIPT)
            .map_err(|e| format!("Failed to inject extraction script: {}", e))?;

        tokio::time::sleep(Duration::from_millis(300)).await;

        let scroll_amount = {
            use rand::Rng;
            rand::thread_rng().gen_range(380u64..720)
        };
        // Dispatch real WheelEvent + ScrollEvent so Instagram's React virtualizer
        // detects the scroll and renders new posts into the DOM.
        let scroll_js = format!(
            r#"(function() {{
                var el = document.scrollingElement || document.documentElement || document.body;
                var target = el.scrollTop + {amt};
                // Simulate wheel delta in small steps so React's scroll handler fires
                var steps = 8;
                var step = {amt} / steps;
                var done = 0;
                function tick() {{
                    el.scrollTop += step;
                    el.dispatchEvent(new Event('scroll', {{bubbles: true}}));
                    window.dispatchEvent(new Event('scroll', {{bubbles: false}}));
                    done++;
                    if (done < steps) setTimeout(tick, 60);
                }}
                tick();
            }})();"#,
            amt = scroll_amount
        );
        wv.eval(&scroll_js).map_err(|e| e.to_string())?;

        // Mouse movement before scroll.
        let cx = 230 + {
            use rand::Rng;
            rand::thread_rng().gen_range(0i32..200)
        };
        let cy = 350 + {
            use rand::Rng;
            rand::thread_rng().gen_range(0i32..200)
        };
        let mouse_js = format!(
            r#"(function(){{var x={cx},y={cy};[0,1,2].forEach(function(i){{setTimeout(function(){{document.dispatchEvent(new MouseEvent('mousemove',{{clientX:x+i*12,clientY:y+i*8,bubbles:true,cancelable:true}}));}},i*80);}});}})();"#,
            cx = cx,
            cy = cy
        );
        let _ = wv.eval(&mouse_js);
        tokio::time::sleep(Duration::from_millis(gaussian_ms(280.0, 60.0))).await;

        // Micro-backscroll ~12% of the time.
        if {
            use rand::Rng;
            rand::thread_rng().gen_bool(0.12)
        } {
            let back = {
                use rand::Rng;
                rand::thread_rng().gen_range(80u64..250)
            };
            let back_js = format!("window.scrollTop -= {};", back);
            let _ = wv.eval(&back_js);
            tokio::time::sleep(Duration::from_millis(gaussian_ms(600.0, 150.0))).await;
        }

        // Gaussian pause; ~25% chance of longer "reading" pause.
        let pause = if {
            use rand::Rng;
            rand::thread_rng().gen_bool(0.25)
        } {
            gaussian_ms(5500.0, 1500.0)
        } else {
            gaussian_ms(4500.0, 700.0)
        };
        tokio::time::sleep(Duration::from_millis(pause)).await;

        info!(
            "[IG] pass {}/{}: scrolled +{}px",
            i + 1,
            num_passes,
            scroll_amount
        );

        // Feed-first ordering: interleave story scrape after early_passes
        if !stories_first && !skip_stories && i + 1 == early_passes {
            info!(
                "[IG] interleaving story scrape after {} feed passes",
                early_passes
            );
            let _ = wv.eval(
                r#"
                (function() {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                })();
            "#,
            );
            tokio::time::sleep(Duration::from_millis(gaussian_ms(1800.0, 400.0))).await;
            scrape_ig_stories(&wv, story_frame_cap).await;
            restore_scraper_feed(&wv, ig_feed_url, "IG").await?;
        }
    }

    wv.eval(IG_EXTRACT_SCRIPT)
        .map_err(|e| format!("Failed to inject extraction script: {}", e))?;

    tokio::time::sleep(Duration::from_millis(500)).await;
    info!(
        "[IG] scrape complete, {} extraction passes emitted",
        num_passes + 1
    );

    Ok(())
}

/// Disconnect Instagram by clearing all browsing data in the scraper WebView.
#[tauri::command]
async fn ig_disconnect(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview_window("ig-scraper") {
        wv.clear_all_browsing_data().map_err(|e| e.to_string())?;
        let _ = wv.destroy();
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — social engagement (WebView like/visit)
// ---------------------------------------------------------------------------

/// Navigate the Facebook scraper WebView to a URL and wait for it to load.
/// Used by the outbox processor to mark posts as seen.
///
/// Returns Ok(()) on navigation success, Err if the window doesn't exist or
/// navigation fails. The caller should treat Err as a retriable failure.
#[tauri::command]
async fn fb_visit_url(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
    url: String,
) -> Result<(), String> {
    let scraper_user_agent = stored_or_default_user_agent(&capture.fb_user_agent);
    let _scraper_session = acquire_background_scraper_session(&capture, "fb_visit_url").await;
    let _recycle_guard = WebviewRecycleGuard::new(app.clone(), "fb-scraper", "visit complete");
    let wv = match app.get_webview_window("fb-scraper") {
        Some(window) => window,
        None => build_cloaked_scraper_window(
            &app,
            "fb-scraper",
            "Freed Facebook",
            &url,
            &scraper_user_agent,
        )?,
    };

    prepare_background_scraper_window(&wv, ScraperWindowMode::Cloaked)?;

    wv.navigate(url.parse().map_err(|e: url::ParseError| e.to_string())?)
        .map_err(|e| e.to_string())?;

    tokio::time::sleep(Duration::from_secs(4)).await;
    Ok(())
}

/// Navigate the Instagram scraper WebView to a URL and wait for it to load.
/// Used by the outbox processor to mark posts as seen.
#[tauri::command]
async fn ig_visit_url(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
    url: String,
) -> Result<(), String> {
    let scraper_user_agent = stored_or_default_user_agent(&capture.ig_user_agent);
    let _scraper_session = acquire_background_scraper_session(&capture, "ig_visit_url").await;
    let _recycle_guard = WebviewRecycleGuard::new(app.clone(), "ig-scraper", "visit complete");
    let wv = match app.get_webview_window("ig-scraper") {
        Some(window) => window,
        None => build_cloaked_scraper_window(
            &app,
            "ig-scraper",
            "Freed Instagram",
            &url,
            &scraper_user_agent,
        )?,
    };

    prepare_background_scraper_window(&wv, ScraperWindowMode::Cloaked)?;

    wv.navigate(url.parse().map_err(|e: url::ParseError| e.to_string())?)
        .map_err(|e| e.to_string())?;

    tokio::time::sleep(Duration::from_secs(4)).await;
    Ok(())
}

/// Navigate to a Facebook post URL and click the Like button (best-effort).
///
/// Navigates the `fb-scraper` WebView to the given URL, waits for render,
/// then injects JS to click `[aria-label="Like"]` and similar selectors.
/// `wv.eval()` cannot return values, so we treat the click as best-effort:
/// Ok(()) means the script was injected, not that the click succeeded.
/// The outbox processor treats this as a success; if the DOM selector missed,
/// the item stays "liked locally" which is an acceptable degradation.
#[tauri::command]
async fn fb_like_post(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
    url: String,
) -> Result<(), String> {
    let scraper_user_agent = stored_or_default_user_agent(&capture.fb_user_agent);
    let _scraper_session = acquire_background_scraper_session(&capture, "fb_like_post").await;
    let _recycle_guard = WebviewRecycleGuard::new(app.clone(), "fb-scraper", "like complete");
    let wv = match app.get_webview_window("fb-scraper") {
        Some(window) => window,
        None => build_cloaked_scraper_window(
            &app,
            "fb-scraper",
            "Freed Facebook",
            &url,
            &scraper_user_agent,
        )?,
    };

    prepare_background_scraper_window(&wv, ScraperWindowMode::Cloaked)?;

    wv.navigate(url.parse().map_err(|e: url::ParseError| e.to_string())?)
        .map_err(|e| e.to_string())?;

    tokio::time::sleep(Duration::from_secs(5)).await;

    wv.eval(
        r#"
        (function() {
            var btn = document.querySelector('[aria-label="Like"]')
                   || document.querySelector('[data-testid="like_button"]')
                   || document.querySelector('div[role="button"][aria-label*="Like"]');
            if (btn) { btn.click(); }
        })();
    "#,
    )
    .map_err(|e| e.to_string())?;

    info!("[FB] fb_like_post: injected like click for {}", url);

    tokio::time::sleep(Duration::from_millis(500)).await;
    Ok(())
}

/// Navigate to an Instagram post URL and click the Like button (best-effort).
///
/// Same best-effort semantics as `fb_like_post`. `wv.eval()` injects the
/// click script but cannot confirm whether the selector matched.
#[tauri::command]
async fn ig_like_post(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
    url: String,
) -> Result<(), String> {
    let scraper_user_agent = stored_or_default_user_agent(&capture.ig_user_agent);
    let _scraper_session = acquire_background_scraper_session(&capture, "ig_like_post").await;
    let _recycle_guard = WebviewRecycleGuard::new(app.clone(), "ig-scraper", "like complete");
    let wv = match app.get_webview_window("ig-scraper") {
        Some(window) => window,
        None => build_cloaked_scraper_window(
            &app,
            "ig-scraper",
            "Freed Instagram",
            &url,
            &scraper_user_agent,
        )?,
    };

    prepare_background_scraper_window(&wv, ScraperWindowMode::Cloaked)?;

    wv.navigate(url.parse().map_err(|e: url::ParseError| e.to_string())?)
        .map_err(|e| e.to_string())?;

    tokio::time::sleep(Duration::from_secs(5)).await;

    wv.eval(
        r#"
        (function() {
            var btn = document.querySelector('[aria-label="Like"]')
                   || (document.querySelector('svg[aria-label="Like"]') || {}).closest
                      && document.querySelector('svg[aria-label="Like"]').closest('button')
                   || document.querySelector('button[type="button"][aria-label*="Like"]');
            if (btn) { btn.click(); }
        })();
    "#,
    )
    .map_err(|e| e.to_string())?;

    info!("[IG] ig_like_post: injected like click for {}", url);

    tokio::time::sleep(Duration::from_millis(500)).await;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — LinkedIn WebView scraper
// ---------------------------------------------------------------------------

/// The extraction script injected into the LinkedIn WebView after page load.
/// Reads posts from the rendered DOM and emits them via Tauri event IPC.
const LI_EXTRACT_SCRIPT: &str = include_str!("li-extract.js");

/// Show a visible WebView window navigated to linkedin.com/login so the
/// user can authenticate through the real LinkedIn login flow.
///
/// An `on_navigation` handler detects when the user completes login
/// (URL leaves /login) and auto-hides the window + emits `li-auth-result`.
#[tauri::command]
async fn li_show_login(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
    user_agent: String,
) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    if let Some(existing) = app.get_webview_window("li-scraper") {
        let _ = set_background_scraper_window_cloak(&existing, false);
        let _ = set_background_scraper_media_guard(&existing, false);
        existing
            .navigate("https://www.linkedin.com/login".parse().unwrap())
            .map_err(|e| e.to_string())?;
        let _ = existing.show();
        let _ = existing.set_focus();
        *capture.li_user_agent.lock().unwrap() = user_agent;
        return Ok(());
    }

    let app_handle = app.clone();
    // Track whether we've already emitted the auth result (one-shot)
    let auth_emitted = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    WebviewWindowBuilder::new(
        &app,
        "li-scraper",
        tauri::WebviewUrl::External("https://www.linkedin.com/login".parse().unwrap()),
    )
    .user_agent(&user_agent)
    .initialization_script(include_str!("webkit-mask.js"))
    .title("Connect LinkedIn with Freed")
    .inner_size(
        460.0 + {
            use rand::Rng;
            rand::thread_rng().gen_range(-8.0f64..8.0)
        },
        700.0 + {
            use rand::Rng;
            rand::thread_rng().gen_range(-10.0f64..10.0)
        },
    )
    .center()
    .visible(true)
    .on_navigation(move |url| {
        let path = url.path();
        let host = url.host_str().unwrap_or("");

        // Detect successful login: navigated away from /login on linkedin.com.
        // Only fire once — don't hide again on subsequent navigations during scraping.
        if host.contains("linkedin.com")
            && path != "/login"
            && path != "/login/"
            && path != "/uas/login"
            && !auth_emitted.swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            if let Some(w) = app_handle.get_webview_window("li-scraper") {
                let _ = w.hide();
            }
            let _ = app_handle.emit("li-auth-result", serde_json::json!({ "loggedIn": true }));
        }

        true
    })
    .build()
    .map_err(|e| e.to_string())?;

    *capture.li_user_agent.lock().unwrap() = user_agent;

    Ok(())
}

/// Hide the LinkedIn login window after successful authentication.
#[tauri::command]
async fn li_hide_login(app: tauri::AppHandle) -> Result<(), String> {
    recycle_webview_window(&app, "li-scraper", "login dismissed");
    Ok(())
}

/// Check whether the LinkedIn WebView has an authenticated session.
///
/// Creates a hidden WebView if none exists, navigates to linkedin.com/feed,
/// waits for the page to settle, then checks for the li_at session cookie.
#[tauri::command]
async fn li_check_auth(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
) -> Result<bool, String> {
    use tauri::WebviewWindowBuilder;

    let scraper_user_agent = stored_or_default_user_agent(&capture.li_user_agent);
    let _scraper_session = acquire_background_scraper_session(&capture, "li_check_auth").await;
    let _recycle_guard = WebviewRecycleGuard::new(app.clone(), "li-scraper", "auth check");
    let wv = match app.get_webview_window("li-scraper") {
        Some(w) => {
            let _ = set_background_scraper_media_guard(&w, true);
            w.navigate("https://www.linkedin.com/feed/".parse().unwrap())
                .map_err(|e| e.to_string())?;
            w
        }
        None => WebviewWindowBuilder::new(
            &app,
            "li-scraper",
            tauri::WebviewUrl::External("https://www.linkedin.com/feed/".parse().unwrap()),
        )
        .user_agent(&scraper_user_agent)
        .initialization_script(include_str!("webkit-mask.js"))
        .initialization_script(INITIALIZE_BACKGROUND_SCRAPER_MEDIA_GUARD_JS)
        .title("Freed LinkedIn")
        .inner_size(460.0, 700.0)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?,
    };
    set_background_scraper_media_guard(&wv, true)?;

    tokio::time::sleep(Duration::from_secs(6)).await;

    wv.eval(
        r#"
        (function() {
            try {
                // LinkedIn uses li_at as its primary session cookie.
                var loggedIn = document.cookie.indexOf('li_at=') !== -1;
                // Secondary check: if we're on the feed page (not login), we're in.
                if (!loggedIn) {
                    loggedIn = window.location.pathname === '/feed/'
                            || window.location.pathname === '/feed';
                }
                window.__TAURI__.event.emit('li-auth-result', { loggedIn: loggedIn });
            } catch(e) {
                window.__TAURI__.event.emit('li-auth-result', { loggedIn: false, error: e.message });
            }
        })();
        "#,
    )
    .map_err(|e| e.to_string())?;

    tokio::time::sleep(Duration::from_millis(250)).await;

    Ok(true)
}

/// Trigger a feed scrape in the LinkedIn WebView.
///
/// Navigates to linkedin.com/feed, waits for content to render, then injects
/// the extraction script which reads the DOM and emits 'li-feed-data'.
/// Multiple extraction passes are run across scroll positions; the final pass
/// emits with `done: true` to signal completion to the TypeScript layer.
///
/// `window_mode` controls visibility during scraping:
/// - `shown`: window is centered and visible during sync.
/// - `cloaked`: window stays visible for WebKit but is transparent and click-through.
/// - `hidden`: window is fully hidden, which is quieter but can be less reliable.
#[tauri::command]
async fn li_scrape_feed(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
    window_mode: ScraperWindowMode,
) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    let li_feed_url = "https://www.linkedin.com/feed/";
    let scraper_user_agent = stored_or_default_user_agent(&capture.li_user_agent);
    let _scraper_session = acquire_background_scraper_session(&capture, "li_scrape_feed").await;
    let _recycle_guard =
        WebviewRecycleGuard::new(app.clone(), "li-scraper", "feed scrape complete");

    let wv = match app.get_webview_window("li-scraper") {
        Some(w) => {
            prepare_background_scraper_window(&w, window_mode)?;
            w.navigate(li_feed_url.parse().unwrap())
                .map_err(|e| e.to_string())?;
            w
        }
        None => {
            let app_handle = app.clone();
            let mut builder = WebviewWindowBuilder::new(
                &app,
                "li-scraper",
                tauri::WebviewUrl::External(li_feed_url.parse().unwrap()),
            )
            .user_agent(&scraper_user_agent)
            .transparent(true)
            .initialization_script(include_str!("webkit-mask.js"))
            .initialization_script(INITIALIZE_BACKGROUND_SCRAPER_MEDIA_GUARD_JS)
            .title("Freed LinkedIn")
            .inner_size(1280.0, 900.0)
            .on_navigation(move |url| {
                let host = url.host_str().unwrap_or("");
                let path = url.path();
                if host.contains("linkedin.com") && path != "/login" && path != "/login/" {
                    let _ =
                        app_handle.emit("li-auth-result", serde_json::json!({ "loggedIn": true }));
                }
                true
            });

            if window_mode == ScraperWindowMode::Shown {
                builder = builder.center().visible(true);
            } else if window_mode == ScraperWindowMode::Cloaked {
                builder = builder
                    .focused(false)
                    .focusable(false)
                    .decorations(false)
                    .always_on_bottom(true)
                    .skip_taskbar(true)
                    .shadow(false)
                    .initialization_script(INITIALIZE_BACKGROUND_SCRAPER_CLOAK_JS)
                    .visible(true);
            } else {
                builder = builder
                    .focused(false)
                    .focusable(false)
                    .decorations(false)
                    .always_on_bottom(true)
                    .skip_taskbar(true)
                    .shadow(false)
                    .visible(false);
            }

            builder.build().map_err(|e| e.to_string())?
        }
    };

    println!(
        "[LI] scrape started (window_mode={}), waiting for feed to render...",
        window_mode.as_str()
    );

    // LinkedIn's feed takes slightly longer to hydrate than Facebook.
    // Use a longer initial wait with more variance.
    tokio::time::sleep(Duration::from_millis(gaussian_ms(12000.0, 2000.0))).await;

    prepare_background_scraper_window(&wv, window_mode)?;
    println!("[LI] window prepared, proceeding with extraction");

    // LinkedIn virtualizes its feed: scroll incrementally, extracting at each
    // position. Fewer passes than FB (LinkedIn loads fewer posts per scroll).
    let num_passes = {
        use rand::Rng;
        rand::thread_rng().gen_range(6usize..=12)
    };

    // Inject the extract script as a const so we can append done=true on last pass.
    let inject_script = |wv: &tauri::WebviewWindow, is_done: bool| -> Result<(), String> {
        wv.eval(LI_EXTRACT_SCRIPT)
            .map_err(|e| format!("Failed to inject LI extraction script: {}", e))?;
        if is_done {
            // Emit a final marker so the TypeScript layer knows to finalize.
            wv.eval(
                r#"
                (function() {
                    if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.emit) {
                        window.__TAURI__.event.emit("li-feed-data", {
                            posts: [], done: true, extractedAt: Date.now(),
                            url: window.location.href, candidateCount: 0, scrollY: window.scrollY
                        });
                    }
                })();
            "#,
            )
            .ok();
        }
        Ok(())
    };

    for i in 0..num_passes {
        prepare_background_scraper_window(&wv, window_mode)?;

        let is_last = i + 1 == num_passes;
        inject_script(&wv, is_last)?;
        tokio::time::sleep(Duration::from_millis(300)).await;

        let scroll_amount = {
            use rand::Rng;
            rand::thread_rng().gen_range(350u64..650)
        };
        // Use stepped scroll events so LinkedIn's React virtualizer fires.
        let scroll_js = format!(
            r#"(function() {{
                var el = document.scrollingElement || document.documentElement || document.body;
                var steps = 8;
                var step = {amt} / steps;
                var done = 0;
                function tick() {{
                    el.scrollTop += step;
                    el.dispatchEvent(new Event('scroll', {{bubbles: true}}));
                    window.dispatchEvent(new Event('scroll', {{bubbles: false}}));
                    done++;
                    if (done < steps) setTimeout(tick, 60);
                }}
                tick();
            }})();"#,
            amt = scroll_amount
        );
        wv.eval(&scroll_js).map_err(|e| e.to_string())?;

        // Mouse movement.
        let cx = 230 + {
            use rand::Rng;
            rand::thread_rng().gen_range(0i32..200)
        };
        let cy = 350 + {
            use rand::Rng;
            rand::thread_rng().gen_range(0i32..200)
        };
        let mouse_js = format!(
            r#"(function(){{var x={cx},y={cy};[0,1,2].forEach(function(i){{setTimeout(function(){{document.dispatchEvent(new MouseEvent('mousemove',{{clientX:x+i*12,clientY:y+i*8,bubbles:true,cancelable:true}}));}},i*80);}});}})();"#,
            cx = cx,
            cy = cy
        );
        let _ = wv.eval(&mouse_js);
        tokio::time::sleep(Duration::from_millis(gaussian_ms(280.0, 60.0))).await;

        // Occasional micro-backscroll (~12% probability).
        if {
            use rand::Rng;
            rand::thread_rng().gen_bool(0.12)
        } {
            let back = {
                use rand::Rng;
                rand::thread_rng().gen_range(80u64..200)
            };
            let back_js = format!("window.scrollBy({{top: -{}, behavior: 'smooth'}});", back);
            let _ = wv.eval(&back_js);
            tokio::time::sleep(Duration::from_millis(gaussian_ms(600.0, 150.0))).await;
        }

        // Gaussian pause; longer pauses more common than FB (LinkedIn users scroll slower).
        let pause = if {
            use rand::Rng;
            rand::thread_rng().gen_bool(0.30)
        } {
            gaussian_ms(7000.0, 2000.0)
        } else {
            gaussian_ms(4000.0, 800.0)
        };
        tokio::time::sleep(Duration::from_millis(pause)).await;

        println!(
            "[LI] pass {}/{}: scrolled +{}px",
            i + 1,
            num_passes,
            scroll_amount
        );
    }

    tokio::time::sleep(Duration::from_millis(500)).await;
    println!(
        "[LI] scrape complete, {} extraction passes emitted",
        num_passes
    );

    Ok(())
}

/// Disconnect LinkedIn by clearing all browsing data in the scraper WebView.
#[tauri::command]
async fn li_disconnect(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview_window("li-scraper") {
        wv.clear_all_browsing_data().map_err(|e| e.to_string())?;
        let _ = wv.destroy();
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// WebSocket relay
// ---------------------------------------------------------------------------

/// Authenticate and handle a single WebSocket connection.
///
/// The client must include `?t=<token>` in the upgrade URI.  Any connection
/// that omits the token or presents an incorrect value is rejected with HTTP
/// 401 before the WebSocket handshake completes — no data is exchanged.
#[cfg_attr(feature = "perf", tracing::instrument(skip(stream, state, app), fields(addr = %addr)))]
async fn handle_connection(
    stream: TcpStream,
    addr: SocketAddr,
    state: RelayState,
    app: tauri::AppHandle,
) {
    info!("[Sync] New connection from: {}", addr);

    // Snapshot the token now — the StdRwLock guard is dropped here, so it is
    // never held across an .await point.
    let expected_token = state.pairing_token.read().unwrap().clone();

    let ws_stream = match accept_hdr_async(
        stream,
        move |req: &WsRequest, resp: WsResponse| -> Result<WsResponse, ErrorResponse> {
            let token_ok = req
                .uri()
                .query()
                .and_then(|q| {
                    // Parse ?t=<value> from the query string
                    q.split('&').find_map(|pair| {
                        let mut kv = pair.splitn(2, '=');
                        (kv.next() == Some("t")).then(|| kv.next()).flatten()
                    })
                })
                .map(|t| t == expected_token.as_str())
                .unwrap_or(false);

            if token_ok {
                Ok(resp)
            } else {
                error!("[Sync] Rejected unauthorized connection from {}", addr);
                Err(tokio_tungstenite::tungstenite::http::Response::builder()
                    .status(401)
                    .body(Some("Unauthorized: rescan the QR code to pair".to_owned()))
                    .unwrap())
            }
        },
    )
    .await
    {
        Ok(ws) => ws,
        Err(e) => {
            // 401 rejections are normal; log everything else
            if !e.to_string().contains("HTTP error") {
                error!("[Sync] WebSocket handshake failed: {}", e);
            }
            return;
        }
    };

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // Increment client count and notify frontend
    {
        let mut count = state.client_count.write().await;
        *count += 1;
        let new_count = *count;
        info!("[Sync] Client connected. Total: {}", new_count);
        let _ = app.emit("sync-client-count", new_count);
    }

    // Push current doc to the new client immediately
    if let Some(doc) = state.current_doc.read().await.clone() {
        if let Err(e) = ws_sender
            .send(Message::Binary(doc.as_ref().clone().into()))
            .await
        {
            error!("[Sync] Failed to send initial doc: {}", e);
        }
    }

    let mut broadcast_rx = state.broadcast_tx.subscribe();

    loop {
        tokio::select! {
            msg = ws_receiver.next() => {
                match msg {
                    Some(Ok(Message::Binary(data))) => {
                        // Client pushed a doc update — store and rebroadcast
                        let bytes = Arc::new(data.to_vec());
                        *state.current_doc.write().await = Some(bytes.clone());
                        let _ = state.broadcast_tx.send(bytes);
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        info!("[Sync] Client {} disconnected", addr);
                        break;
                    }
                    Some(Ok(Message::Ping(data))) => {
                        let _ = ws_sender.send(Message::Pong(data)).await;
                    }
                    Some(Err(e)) => {
                        error!("[Sync] Error from {}: {}", addr, e);
                        break;
                    }
                    _ => {}
                }
            }
            broadcast = broadcast_rx.recv() => {
                if let Ok(doc) = broadcast {
                    if let Err(e) = ws_sender.send(Message::Binary(doc.as_ref().clone().into())).await {
                        error!("[Sync] Failed to send to {}: {}", addr, e);
                        break;
                    }
                }
            }
        }
    }

    // Decrement client count and notify frontend
    {
        let mut count = state.client_count.write().await;
        *count = count.saturating_sub(1);
        let new_count = *count;
        info!("[Sync] Client disconnected. Total: {}", new_count);
        let _ = app.emit("sync-client-count", new_count);
    }
}

async fn start_sync_relay(state: RelayState, app: tauri::AppHandle) {
    let addr = format!("0.0.0.0:{}", state.port);

    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            error!("[Sync] Failed to bind to {}: {}", addr, e);
            return;
        }
    };

    info!("[Sync] Relay server listening on {}", addr);

    while let Ok((stream, addr)) = listener.accept().await {
        let state = state.clone();
        let app = app.clone();
        tokio::spawn(handle_connection(stream, addr, state, app));
    }
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn main_window_webview_configuration() -> Retained<WKWebViewConfiguration> {
    let mtm = MainThreadMarker::new()
        .expect("WKWebView configuration must be created on the main thread");
    let config = unsafe { WKWebViewConfiguration::new(mtm) };
    let display_name = NSString::from_str("Freed");

    // Label the WebKit content process as "Freed" in Activity Monitor instead
    // of leaving the default custom protocol URL visible.
    unsafe {
        config.setValue_forKey(
            Some(display_name.as_ref()),
            ns_string!("processDisplayName"),
        );
    }

    config
}

fn create_main_window(app: &tauri::App) -> Result<tauri::WebviewWindow, tauri::Error> {
    if let Some(window) = app.get_webview_window("main") {
        return Ok(window);
    }

    let window_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == "main")
        .expect("missing main window config")
        .clone();

    let builder = tauri::WebviewWindowBuilder::from_config(app, &window_config)?;

    #[cfg(target_os = "macos")]
    let builder = builder.with_webview_configuration(main_window_webview_configuration());

    builder.build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // When built with --features perf, initialise a JSON tracing subscriber so
    // span durations for write_snapshot / prune_snapshots / broadcast_doc are
    // emitted to stderr. Collect with:
    //   RUST_LOG=freed_desktop_lib=trace ./freed-desktop 2>trace.jsonl
    #[cfg(feature = "perf")]
    {
        use tracing_subscriber::{fmt, EnvFilter};
        fmt()
            .json()
            .with_env_filter(EnvFilter::from_default_env())
            .with_span_events(fmt::format::FmtSpan::CLOSE)
            .init();
    }

    let (broadcast_tx, _) = broadcast::channel::<Arc<Vec<u8>>>(16);

    let relay_state = Arc::new(SyncRelayState {
        port: sync_relay_port(),
        broadcast_tx,
        current_doc: RwLock::new(None),
        client_count: RwLock::new(0),
        // Populated from disk in .setup() before the relay starts accepting connections.
        pairing_token: StdRwLock::new(String::new()),
    });

    let relay_state_clone = relay_state.clone();
    let log_plugin = {
        let builder = tauri_plugin_log::Builder::new()
            .level(log::LevelFilter::Info)
            .max_file_size(10 * 1024 * 1024)
            .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll);

        #[cfg(debug_assertions)]
        let builder = builder.clear_targets().targets([
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
        ]);

        builder.build()
    };

    tauri::Builder::default()
        // Debug builds log to stdout and the webview so local startup is not
        // blocked by host filesystem permissions. Release builds keep
        // structured rotating file logs in the OS log directory.
        .plugin(log_plugin)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .manage(relay_state)
        .manage(CaptureState::new())
        .setup(move |app| {
            let window = create_main_window(app)?;

            #[cfg(target_os = "macos")]
            apply_vibrancy(
                &window,
                NSVisualEffectMaterial::UnderWindowBackground,
                None,
                None,
            )
            .expect("Failed to apply vibrancy");

            // Load (or generate) the persistent pairing token before the relay
            // starts accepting connections.
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");
            std::fs::create_dir_all(&data_dir).ok();
            let token = load_or_create_token(&data_dir);
            *relay_state_clone.pairing_token.write().unwrap() = token;

            // Build system tray
            let show_item = MenuItem::with_id(app, "show", "Show Freed", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Freed", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .menu(&menu)
                .tooltip("Freed — Sync running")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Log Facebook scraper events to stdout for debugging.
            // Track unique posts across multiple extraction passes.
            use std::sync::atomic::{AtomicUsize, Ordering};
            let fb_unique_ids: Arc<StdRwLock<std::collections::HashSet<String>>> =
                Arc::new(StdRwLock::new(std::collections::HashSet::new()));
            let fb_total_posts = Arc::new(AtomicUsize::new(0));
            let fb_ids_clone = fb_unique_ids.clone();
            let fb_total_clone = fb_total_posts.clone();

            let app_for_fb = app.handle().clone();
            app_for_fb.listen("fb-feed-data", move |event| {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                    let scroll_y = val.get("scrollY")
                        .and_then(|s| s.as_f64())
                        .unwrap_or(0.0) as i64;
                    let candidates = val.get("candidateCount")
                        .and_then(|c| c.as_u64())
                        .unwrap_or(0);
                    let error = val.get("error")
                        .and_then(|e| e.as_str())
                        .unwrap_or("");

                    if !error.is_empty() {
                        info!("[FB] extraction error: {}", error);
                        return;
                    }

                    let mut new_count = 0usize;
                    if let Some(posts) = val.get("posts").and_then(|p| p.as_array()) {
                        let mut ids = fb_ids_clone.write().unwrap();
                        for post in posts {
                            let id = post.get("id")
                                .and_then(|i| i.as_str())
                                .unwrap_or("")
                                .to_string();
                            if !id.is_empty() && ids.insert(id) {
                                new_count += 1;
                                let total = fb_total_clone.fetch_add(1, Ordering::Relaxed) + 1;
                                let author = post.get("authorName")
                                    .and_then(|a| a.as_str())
                                    .unwrap_or("?");
                                let text = post.get("text")
                                    .and_then(|t| t.as_str())
                                    .unwrap_or("")
                                    .chars()
                                    .take(80)
                                    .collect::<String>();
                                let strategy = post.get("strategy")
                                    .and_then(|s| s.as_str())
                                    .unwrap_or("?");
                                info!("[FB]   #{}: [{}] {} — {:?}", total, strategy, author, text);
                            }
                        }
                    }

                    let total = fb_total_clone.load(Ordering::Relaxed);
                    info!("[FB] pass @ scrollY={}: candidates={}, new={}, total_unique={}",
                        scroll_y, candidates, new_count, total);
                }
            });

            app_for_fb.listen("fb-diag", |event| {
                let payload = event.payload();
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(payload) {
                    if let Ok(pretty) = serde_json::to_string_pretty(&val) {
                        info!("[FB] diag:\n{}", pretty);
                    } else {
                        info!("[FB] diag: {}", payload);
                    }
                } else {
                    info!("[FB] diag: {}", payload);
                }
            });

            let app_for_gql = app.handle().clone();
            app_for_gql.listen("fb-graphql", |event| {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                    let url = val.get("url").and_then(|u| u.as_str()).unwrap_or("?");
                    let size = val.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
                    let status = val.get("status").and_then(|s| s.as_u64()).unwrap_or(0);
                    let preview = val.get("preview").and_then(|p| p.as_str()).unwrap_or("");
                    info!("[FB-GQL] {} status={} size={} preview={:?}",
                        url, status, size, &preview[..preview.len().min(200)]);
                }
            });

            // Log Instagram scraper events to stdout for debugging.
            let ig_unique_ids: Arc<StdRwLock<std::collections::HashSet<String>>> =
                Arc::new(StdRwLock::new(std::collections::HashSet::new()));
            let ig_total_posts = Arc::new(AtomicUsize::new(0));
            let ig_ids_clone = ig_unique_ids.clone();
            let ig_total_clone = ig_total_posts.clone();

            let app_for_ig = app.handle().clone();
            app_for_ig.listen("ig-feed-data", move |event| {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                    let scroll_y = val.get("scrollY")
                        .and_then(|s| s.as_f64())
                        .unwrap_or(0.0) as i64;
                    let candidates = val.get("candidateCount")
                        .and_then(|c| c.as_u64())
                        .unwrap_or(0);
                    let error = val.get("error")
                        .and_then(|e| e.as_str())
                        .unwrap_or("");

                    if !error.is_empty() {
                        info!("[IG] extraction error: {}", error);
                        return;
                    }

                    let mut new_count = 0usize;
                    if let Some(posts) = val.get("posts").and_then(|p| p.as_array()) {
                        let mut ids = ig_ids_clone.write().unwrap();
                        for post in posts {
                            let id = post.get("shortcode")
                                .and_then(|i| i.as_str())
                                .unwrap_or("")
                                .to_string();
                            if !id.is_empty() && ids.insert(id) {
                                new_count += 1;
                                let total = ig_total_clone.fetch_add(1, Ordering::Relaxed) + 1;
                                let author = post.get("authorHandle")
                                    .and_then(|a| a.as_str())
                                    .unwrap_or("?");
                                let text = post.get("caption")
                                    .and_then(|t| t.as_str())
                                    .unwrap_or("")
                                    .chars()
                                    .take(80)
                                    .collect::<String>();
                                info!("[IG]   #{}: @{} — {:?}", total, author, text);
                            }
                        }
                    }

                    let total = ig_total_clone.load(Ordering::Relaxed);
                    let strategy = val.get("strategy").and_then(|s| s.as_str()).unwrap_or("?");
                    let url = val.get("url").and_then(|u| u.as_str()).unwrap_or("?");
                    info!("[IG] pass @ scrollY={}: candidates={}, new={}, total_unique={}, strategy={}, url={}",
                        scroll_y, candidates, new_count, total, strategy, &url[..url.len().min(60)]);
                }
            });

            let renderer_health = Arc::new(StdRwLock::new(RendererHeartbeatStatus::new()));
            let renderer_health_for_listener = renderer_health.clone();
            let app_for_renderer = app.handle().clone();
            app_for_renderer.listen("renderer-heartbeat", move |event| {
                let payload = match serde_json::from_str::<RendererHeartbeatPayload>(event.payload()) {
                    Ok(payload) => payload,
                    Err(error) => {
                        warn!(
                            "[main-window] invalid renderer-heartbeat payload err={} payload={}",
                            error,
                            event.payload()
                        );
                        return;
                    }
                };

                let now = std::time::Instant::now();
                let mut health = renderer_health_for_listener.write().unwrap();
                let gap_ms = health
                    .last_seen_at
                    .map(|last| now.duration_since(last).as_millis())
                    .unwrap_or_else(|| now.duration_since(health.started_at).as_millis());
                let recovered = health.stale_logged;

                health.last_seen_at = Some(now);
                health.last_seq = payload.seq;
                health.last_reason = payload.reason.clone();
                health.last_visibility = payload.visibility.clone();
                health.last_href = payload.href.clone();
                health.stale_logged = false;

                let href = truncate_for_log(&payload.href, 120);
                if recovered {
                    warn!(
                        "[main-window] renderer heartbeat recovered seq={} gap_ms={} reason={} visibility={} href={} ts={}",
                        payload.seq,
                        gap_ms,
                        payload.reason,
                        payload.visibility,
                        href,
                        payload.ts
                    );
                } else {
                    info!(
                        "[main-window] renderer heartbeat seq={} reason={} visibility={} href={} ts={}",
                        payload.seq,
                        payload.reason,
                        payload.visibility,
                        href,
                        payload.ts
                    );
                }
            });

            let renderer_health_for_watchdog = renderer_health.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(30)).await;

                    let mut health = renderer_health_for_watchdog.write().unwrap();
                    let age = health
                        .last_seen_at
                        .map(|last| last.elapsed())
                        .unwrap_or_else(|| health.started_at.elapsed());

                    if age <= Duration::from_secs(150) || health.stale_logged {
                        continue;
                    }

                    warn!(
                        "[main-window] renderer heartbeat stale age_ms={} last_seq={} last_reason={} visibility={} href={}",
                        age.as_millis(),
                        health.last_seq,
                        health.last_reason,
                        health.last_visibility,
                        truncate_for_log(&health.last_href, 120)
                    );
                    health.stale_logged = true;
                }
            });

            // Start mDNS advertisement and keep the daemon alive.
            let mdns_daemon = advertise_mdns(relay_state_clone.port);
            app.manage(MdnsState(mdns_daemon));

            // Start the relay — token is already set, so new connections are
            // immediately subject to authentication.
            let state = relay_state_clone.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                start_sync_relay(state, app_handle).await;
            });

            // Dev-only: auto-trigger a Facebook scrape on startup so we can
            // iterate without manual clicking. Set FB_AUTO_SCRAPE=1 env var.
            if std::env::var("FB_AUTO_SCRAPE").unwrap_or_default() == "1" {
                let auto_app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    info!("[FB] auto-scrape enabled, waiting 8s for app init...");
                    tokio::time::sleep(Duration::from_secs(8)).await;
                    info!("[FB] triggering auto-scrape now");
                    // Dev env var auto-scrape: keep the window shown during
                    // development iteration.
                    let capture = auto_app.state::<CaptureState>();
                    match fb_scrape_feed(auto_app.clone(), capture, ScraperWindowMode::Shown).await {
                        Ok(()) => info!("[FB] auto-scrape command returned OK"),
                        Err(e) => info!("[FB] auto-scrape error: {}", e),
                    }
                });
            }

            // Dev-only: auto-trigger an Instagram scrape on startup so we can
            // iterate without manual clicking. Set IG_AUTO_SCRAPE=1 env var.
            if std::env::var("IG_AUTO_SCRAPE").unwrap_or_default() == "1" {
                let auto_app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    info!("[IG] auto-scrape enabled, waiting 8s for app init...");
                    tokio::time::sleep(Duration::from_secs(8)).await;
                    info!("[IG] triggering auto-scrape now");
                    // Dev env var auto-scrape: keep the window shown during
                    // development iteration.
                    let capture = auto_app.state::<CaptureState>();
                    match ig_scrape_feed(auto_app.clone(), capture, ScraperWindowMode::Shown).await {
                        Ok(()) => info!("[IG] auto-scrape command returned OK"),
                        Err(e) => info!("[IG] auto-scrape error: {}", e),
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    window.hide().unwrap();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_version,
            get_platform,
            get_updater_target,
            fetch_url,
            x_api_request,
            get_local_ip,
            get_all_local_ips,
            get_sync_url,
            get_sync_client_count,
            get_runtime_memory_stats,
            broadcast_doc,
            reset_pairing_token,
            show_window,
            open_x_login_window,
            check_x_login_cookies,
            close_x_login_window,
            get_mdns_active,
            list_snapshots,
            get_recent_logs,
            start_oauth_server,
            pick_contact,
            fb_show_login,
            fb_hide_login,
            fb_check_auth,
            fb_scrape_feed,
            fb_scrape_groups,
            fb_disconnect,
            ig_show_login,
            ig_hide_login,
            ig_check_auth,
            ig_scrape_feed,
            ig_disconnect,
            fb_visit_url,
            ig_visit_url,
            fb_like_post,
            ig_like_post,
            li_show_login,
            li_hide_login,
            li_check_auth,
            li_scrape_feed,
            li_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Freed");
}
