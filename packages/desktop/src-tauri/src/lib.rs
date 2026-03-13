//! Freed Desktop Application
//!
//! Native desktop app that bundles capture, sync relay, and reader UI.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use log::{error, info, warn};
use futures_util::{SinkExt, StreamExt};
use rand::RngCore;
use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock as StdRwLock};
use tauri::{Emitter, Listener, Manager};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
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
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

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
    broadcast_tx: broadcast::Sender<Vec<u8>>,
    /// Latest doc binary, served to new joiners immediately on connect.
    current_doc: RwLock<Option<Vec<u8>>>,
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

// ---------------------------------------------------------------------------
// Capture state — shared UA strings and HTTP client for social scrapers
// ---------------------------------------------------------------------------

/// Per-session user agent strings set by TypeScript at platform connect time,
/// plus a shared rquest HTTP client with persistent connection pooling.
struct CaptureState {
    fb_user_agent: std::sync::Mutex<String>,
    ig_user_agent: std::sync::Mutex<String>,
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
            x_client,
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
    let port = 8765u16;
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
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
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

/// Push a document update to all connected clients.
#[cfg_attr(feature = "perf", tracing::instrument(skip(state, app, doc_bytes), fields(bytes = doc_bytes.len())))]
#[tauri::command]
async fn broadcast_doc(
    state: tauri::State<'_, RelayState>,
    app: tauri::AppHandle,
    doc_bytes: Vec<u8>,
) -> Result<(), String> {
    // Write a GFS snapshot before touching broadcast state — recovery is
    // always possible even if the broadcast itself fails.
    if let Ok(data_dir) = app.path().app_data_dir() {
        let snapshot_dir = data_dir.join("snapshots");
        let bytes = doc_bytes.clone();
        tokio::task::spawn_blocking(move || write_snapshot(&snapshot_dir, &bytes))
            .await
            .ok();
    }

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

    let _ = app.emit("cloud-oauth-code", serde_json::json!({ "code": code, "state": state }));

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

    async fn accept_one(
        listener: TcpListener,
        tx: tokio::sync::oneshot::Sender<TcpStream>,
    ) {
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
const FB_STORIES_EXTRACT_SCRIPT: &str = include_str!("fb-stories-extract.js");

/// Show a visible WebView window navigated to facebook.com/login so the
/// user can authenticate through the real Facebook login flow.
///
/// The window reuses the "fb-scraper" label. If it already exists it is
/// shown and focused; otherwise a new window is created.
///
/// An `on_navigation` handler detects when the user completes login
/// (URL leaves /login) and auto-hides the window + emits `fb-auth-result`.
#[tauri::command]
async fn fb_show_login(app: tauri::AppHandle, capture: tauri::State<'_, CaptureState>, user_agent: String) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    if let Some(existing) = app.get_webview_window("fb-scraper") {
        existing.navigate("https://www.facebook.com/login".parse().unwrap())
            .map_err(|e| e.to_string())?;
        let _ = existing.show();
        let _ = existing.set_focus();
        // Update the stored UA in case it changed since last connect.
        *capture.fb_user_agent.lock().unwrap() = user_agent;
        return Ok(());
    }

    let app_handle = app.clone();

    WebviewWindowBuilder::new(
        &app,
        "fb-scraper",
        tauri::WebviewUrl::External("https://www.facebook.com/login".parse().unwrap()),
    )
    .user_agent(&user_agent)
    .initialization_script(include_str!("webkit-mask.js"))
    .title("Connect Facebook — Freed")
    .inner_size(
        460.0 + { use rand::Rng; rand::thread_rng().gen_range(-8.0f64..8.0) },
        700.0 + { use rand::Rng; rand::thread_rng().gen_range(-10.0f64..10.0) },
    )
    .center()
    .visible(true)
    .on_navigation(move |url| {
        let path = url.path();
        let host = url.host_str().unwrap_or("");

        // Detect successful login: navigated away from /login on a facebook domain
        if host.contains("facebook.com") && path != "/login" && path != "/login/" {
            if let Some(w) = app_handle.get_webview_window("fb-scraper") {
                let _ = w.hide();
            }
            let _ = app_handle.emit("fb-auth-result", serde_json::json!({ "loggedIn": true }));
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
    if let Some(w) = app.get_webview_window("fb-scraper") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Check whether the Facebook WebView has an authenticated session.
///
/// Creates a hidden WebView if none exists, navigates to facebook.com,
/// waits for the page to settle, then checks for logged-in indicators
/// (USER_ID != "0" in the page source).
#[tauri::command]
async fn fb_check_auth(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri::WebviewWindowBuilder;

    let wv = match app.get_webview_window("fb-scraper") {
        Some(w) => w,
        None => {
            WebviewWindowBuilder::new(
                &app,
                "fb-scraper",
                tauri::WebviewUrl::External(
                    "https://www.facebook.com/".parse().unwrap(),
                ),
            )
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15")
            .title("Freed Facebook")
            .inner_size(460.0, 700.0)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?
        }
    };

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

    println!("[FB] starting story scrape (max {} frames)", max_frames);

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

    println!("[IG] starting story scrape (max {} frames)", max_frames);

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
/// `show_window` controls visibility during scraping:
/// - `false` (default): window is positioned off-screen at (-20000, -20000) so
///   WebKit renders at full speed without the window appearing on the user's desktop.
/// - `true` (debug): window is centered and focused, matching the original behavior.
#[tauri::command]
async fn fb_scrape_feed(app: tauri::AppHandle, capture: tauri::State<'_, CaptureState>, show_window: bool) -> Result<(), String> {
    use tauri::{LogicalPosition, WebviewWindowBuilder};

    let fb_feed_url = "https://www.facebook.com/";

    let wv = match app.get_webview_window("fb-scraper") {
        Some(w) => {
            w.navigate(fb_feed_url.parse().unwrap())
                .map_err(|e| e.to_string())?;
            if show_window {
                let _ = w.center();
                let _ = w.set_focus();
            } else {
                let _ = w.set_position(LogicalPosition::new(-20000.0_f64, -20000.0_f64));
            }
            let _ = w.show();
            w
        }
        None => {
            let app_handle = app.clone();
            let mut builder = WebviewWindowBuilder::new(
                &app,
                "fb-scraper",
                tauri::WebviewUrl::External(
                    fb_feed_url.parse().unwrap(),
                ),
            )
            .user_agent(&*capture.fb_user_agent.lock().unwrap())
            .initialization_script(include_str!("webkit-mask.js"))
            .title("Freed Facebook")
            .inner_size(1280.0, 900.0)
            .visible(true)
            .on_navigation(move |url| {
                let host = url.host_str().unwrap_or("");
                let path = url.path();
                if host.contains("facebook.com") && path != "/login" && path != "/login/" {
                    if let Some(w) = app_handle.get_webview_window("fb-scraper") {
                        let _ = w.hide();
                    }
                    let _ = app_handle.emit("fb-auth-result",
                        serde_json::json!({ "loggedIn": true }));
                }
                true
            });

            if show_window {
                builder = builder.center();
            } else {
                builder = builder.position(-20000.0, -20000.0);
            }

            builder.build().map_err(|e| e.to_string())?
        }
    };

    info!("[FB] scrape started (show_window={}), waiting for page load...", show_window);

    tokio::time::sleep(Duration::from_millis(gaussian_ms(13000.0, 1500.0))).await;

    wv.eval(r#"
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
    "#).map_err(|e| e.to_string())?;
    tokio::time::sleep(Duration::from_millis(300)).await;

    // Randomized ordering: ~50% stories-first, ~50% feed-first.
    // ~15% chance to skip story scraping entirely (real users don't always check stories).
    let skip_stories = { use rand::Rng; rand::thread_rng().gen_bool(0.15) };
    let stories_first = !skip_stories && { use rand::Rng; rand::thread_rng().gen_bool(0.50) };
    let story_frame_cap = { use rand::Rng; rand::thread_rng().gen_range(10usize..=30) };

    if stories_first {
        println!("[FB] coin flip: stories FIRST");
        scrape_fb_stories(&wv, story_frame_cap).await;
        // Scroll back to top after exiting story viewer so the feed loop starts fresh
        let _ = wv.eval("window.scrollTo({ top: 0, behavior: 'instant' });");
        tokio::time::sleep(Duration::from_millis(gaussian_ms(1500.0, 300.0))).await;
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
        // Keep window visible — WebKit throttles hidden windows, even off-screen ones.
        let _ = wv.show();

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
        let cx = 230 + { use rand::Rng; rand::thread_rng().gen_range(0i32..200) };
        let cy = 350 + { use rand::Rng; rand::thread_rng().gen_range(0i32..200) };
        let mouse_js = format!(
            r#"(function(){{var x={cx},y={cy};[0,1,2].forEach(function(i){{setTimeout(function(){{document.dispatchEvent(new MouseEvent('mousemove',{{clientX:x+i*12,clientY:y+i*8,bubbles:true,cancelable:true}}));}},i*80);}});}})();"#,
            cx = cx, cy = cy
        );
        let _ = wv.eval(&mouse_js);
        tokio::time::sleep(Duration::from_millis(gaussian_ms(280.0, 60.0))).await;

        // Occasional micro-backscroll (~12% probability) simulates re-reading.
        if { use rand::Rng; rand::thread_rng().gen_bool(0.12) } {
            let back = { use rand::Rng; rand::thread_rng().gen_range(80u64..250) };
            let back_js = format!("window.scrollBy({{top: -{}, behavior: 'smooth'}});", back);
            let _ = wv.eval(&back_js);
            tokio::time::sleep(Duration::from_millis(gaussian_ms(600.0, 150.0))).await;
        }

        // Gaussian pause between scroll passes; ~25% chance of a longer "reading" pause.
        let pause = if { use rand::Rng; rand::thread_rng().gen_bool(0.25) } {
            gaussian_ms(6000.0, 1500.0)
        } else {
            gaussian_ms(2750.0, 600.0)
        };
        tokio::time::sleep(Duration::from_millis(pause)).await;

        info!("[FB] pass {}/{}: scrolled +{}px", i + 1, num_passes, scroll_amount);

        // Feed-first ordering: after early_passes, scroll back to top and scrape stories
        if !stories_first && !skip_stories && i + 1 == early_passes {
            info!("[FB] interleaving story scrape after {} feed passes", early_passes);
            let _ = wv.eval("window.scrollTo({ top: 0, behavior: 'smooth' });");
            tokio::time::sleep(Duration::from_millis(gaussian_ms(1800.0, 400.0))).await;
            scrape_fb_stories(&wv, story_frame_cap).await;
            // Return to feed position after story viewing
            let _ = wv.eval("window.scrollTo({ top: 0, behavior: 'instant' });");
            tokio::time::sleep(Duration::from_millis(gaussian_ms(1200.0, 300.0))).await;
        }
    }

    wv.eval(FB_EXTRACT_SCRIPT)
        .map_err(|e| format!("Failed to inject extraction script: {}", e))?;

    tokio::time::sleep(Duration::from_millis(500)).await;
    info!("[FB] scrape complete, {} extraction passes emitted", num_passes + 1);

    // Hide the window now that scraping is done. The window stays alive in the
    // background to preserve the authenticated session for the next scrape.
    let _ = wv.hide();

    Ok(())
}

/// Disconnect Facebook by clearing all browsing data in the scraper WebView.
#[tauri::command]
async fn fb_disconnect(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview_window("fb-scraper") {
        wv.clear_all_browsing_data()
            .map_err(|e| e.to_string())?;
        let _ = wv.close();
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
async fn ig_show_login(app: tauri::AppHandle, capture: tauri::State<'_, CaptureState>, user_agent: String) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    if let Some(existing) = app.get_webview_window("ig-scraper") {
        existing.navigate("https://www.instagram.com/accounts/login/".parse().unwrap())
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
        460.0 + { use rand::Rng; rand::thread_rng().gen_range(-8.0f64..8.0) },
        700.0 + { use rand::Rng; rand::thread_rng().gen_range(-10.0f64..10.0) },
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
            // Hide the login UI — the window stays alive for scraping but is not
            // visible to the user. ig_scrape_feed will show it again when needed.
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
                // Auto-scrapes never show the window -- user didn't request debug mode.
                match ig_scrape_feed(scrape_app.clone(), capture, false).await {
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
    if let Some(w) = app.get_webview_window("ig-scraper") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Check whether the Instagram WebView has an authenticated session.
///
/// Creates a hidden WebView if none exists, navigates to instagram.com,
/// waits for the page to settle, then checks for the sessionid cookie.
#[tauri::command]
async fn ig_check_auth(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri::WebviewWindowBuilder;

    let wv = match app.get_webview_window("ig-scraper") {
        Some(w) => w,
        None => {
            WebviewWindowBuilder::new(
                &app,
                "ig-scraper",
                tauri::WebviewUrl::External(
                    "https://www.instagram.com/".parse().unwrap(),
                ),
            )
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15")
            .title("Freed Instagram")
            .inner_size(460.0, 700.0)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?
        }
    };

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

    Ok(true)
}

/// Trigger a feed scrape in the hidden Instagram WebView.
///
/// Navigates to instagram.com, waits for content to render, then injects
/// the extraction script which reads the DOM and emits 'ig-feed-data'.
///
/// `show_window` controls visibility during scraping:
/// - `false` (default): window is positioned off-screen at (-20000, -20000) so
///   WebKit renders at full speed without the window appearing on the user's desktop.
/// - `true` (debug): window is centered and on-screen, matching the original behavior.
#[tauri::command]
async fn ig_scrape_feed(app: tauri::AppHandle, capture: tauri::State<'_, CaptureState>, show_window: bool) -> Result<(), String> {
    use tauri::{LogicalPosition, WebviewWindowBuilder};

    let ig_feed_url = "https://www.instagram.com/?variant=following";

    let wv = match app.get_webview_window("ig-scraper") {
        Some(w) => {
            // Window exists (user already logged in). Re-position then show.
            // DO NOT re-navigate — that would fire the ig_show_login on_navigation
            // callback which hides the window, causing WebKit to throttle rendering.
            if show_window {
                let _ = w.center();
                let _ = w.set_focus();
            } else {
                let _ = w.set_position(LogicalPosition::new(-20000.0_f64, -20000.0_f64));
            }
            let _ = w.show();
            info!("[IG] reusing existing ig-scraper window (show_window={})", show_window);
            w
        }
        None => {
            // No existing window — create one. This path runs on first-ever scrape
            // (when the user hasn't gone through ig_show_login yet, e.g. auto-scrape).
            let app_handle = app.clone();
            let mut builder = WebviewWindowBuilder::new(
                &app,
                "ig-scraper",
                tauri::WebviewUrl::External(
                    ig_feed_url.parse().unwrap(),
                ),
            )
            .user_agent(&*capture.ig_user_agent.lock().unwrap())
            .initialization_script(include_str!("webkit-mask.js"))
            .title("Freed Instagram")
            .inner_size(1280.0, 900.0)
            .visible(true)
            .on_navigation(move |url| {
                let path = url.path();
                let host = url.host_str().unwrap_or("");
                if host.contains("instagram.com")
                    && (path == "/accounts/login" || path == "/accounts/login/")
                {
                    // Still on login — do nothing
                } else if host.contains("instagram.com") {
                    let _ = app_handle.emit("ig-auth-result",
                        serde_json::json!({ "loggedIn": true }));
                }
                true
            });

            if show_window {
                builder = builder.center();
            } else {
                builder = builder.position(-20000.0, -20000.0);
            }

            builder.build().map_err(|e| e.to_string())?
        }
    };

    info!("[IG] scrape started (show_window={}), waiting for feed to render...", show_window);

    tokio::time::sleep(Duration::from_millis(gaussian_ms(9000.0, 1200.0))).await;

    // Ensure window is still visible so WebKit doesn't throttle JS execution.
    // Do NOT set_focus here — we don't want to yank focus from the user's
    // foreground app on every scrape pass.
    let _ = wv.show();
    info!("[IG] window visible, proceeding with extraction");

    // Belt-and-suspenders: click the Following tab if present
    let _ = wv.eval(r#"document.querySelector('a[href="/?variant=following"]')?.click();"#);
    tokio::time::sleep(Duration::from_millis(2000)).await;

    // Randomized ordering: ~50% stories-first, ~50% feed-first.
    // ~15% chance to skip story scraping entirely.
    let skip_stories = { use rand::Rng; rand::thread_rng().gen_bool(0.15) };
    let stories_first = !skip_stories && { use rand::Rng; rand::thread_rng().gen_bool(0.50) };
    let story_frame_cap = { use rand::Rng; rand::thread_rng().gen_range(10usize..=30) };

    if stories_first {
        println!("[IG] coin flip: stories FIRST");
        scrape_ig_stories(&wv, story_frame_cap).await;
        // Navigate back to the following feed and scroll to top
        let _ = wv.eval(r#"
            (function() {
                window.scrollTo({ top: 0, behavior: 'instant' });
                var tab = document.querySelector('a[href="/?variant=following"]');
                if (tab) tab.click();
            })();
        "#);
        tokio::time::sleep(Duration::from_millis(gaussian_ms(1500.0, 300.0))).await;
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
        // Keep window visible — WebKit throttles hidden windows
        let _ = wv.show();

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
        let cx = 230 + { use rand::Rng; rand::thread_rng().gen_range(0i32..200) };
        let cy = 350 + { use rand::Rng; rand::thread_rng().gen_range(0i32..200) };
        let mouse_js = format!(
            r#"(function(){{var x={cx},y={cy};[0,1,2].forEach(function(i){{setTimeout(function(){{document.dispatchEvent(new MouseEvent('mousemove',{{clientX:x+i*12,clientY:y+i*8,bubbles:true,cancelable:true}}));}},i*80);}});}})();"#,
            cx = cx, cy = cy
        );
        let _ = wv.eval(&mouse_js);
        tokio::time::sleep(Duration::from_millis(gaussian_ms(280.0, 60.0))).await;

        // Micro-backscroll ~12% of the time.
        if { use rand::Rng; rand::thread_rng().gen_bool(0.12) } {
            let back = { use rand::Rng; rand::thread_rng().gen_range(80u64..250) };
            let back_js = format!("window.scrollTop -= {};", back);
            let _ = wv.eval(&back_js);
            tokio::time::sleep(Duration::from_millis(gaussian_ms(600.0, 150.0))).await;
        }

        // Gaussian pause; ~25% chance of longer "reading" pause.
        let pause = if { use rand::Rng; rand::thread_rng().gen_bool(0.25) } {
            gaussian_ms(5500.0, 1500.0)
        } else {
            gaussian_ms(4500.0, 700.0)
        };
        tokio::time::sleep(Duration::from_millis(pause)).await;

        info!("[IG] pass {}/{}: scrolled +{}px", i + 1, num_passes, scroll_amount);

        // Feed-first ordering: interleave story scrape after early_passes
        if !stories_first && !skip_stories && i + 1 == early_passes {
            info!("[IG] interleaving story scrape after {} feed passes", early_passes);
            let _ = wv.eval(r#"
                (function() {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                })();
            "#);
            tokio::time::sleep(Duration::from_millis(gaussian_ms(1800.0, 400.0))).await;
            scrape_ig_stories(&wv, story_frame_cap).await;
            // Return to feed
            let _ = wv.eval(r#"
                (function() {
                    window.scrollTo({ top: 0, behavior: 'instant' });
                    var tab = document.querySelector('a[href="/?variant=following"]');
                    if (tab) tab.click();
                })();
            "#);
            tokio::time::sleep(Duration::from_millis(gaussian_ms(1200.0, 300.0))).await;
        }
    }

    wv.eval(IG_EXTRACT_SCRIPT)
        .map_err(|e| format!("Failed to inject extraction script: {}", e))?;

    tokio::time::sleep(Duration::from_millis(500)).await;
    info!("[IG] scrape complete, {} extraction passes emitted", num_passes + 1);

    // Hide the window now that scraping is done. The window stays alive in the
    // background to preserve the authenticated session for the next scrape.
    let _ = wv.hide();

    Ok(())
}

/// Disconnect Instagram by clearing all browsing data in the scraper WebView.
#[tauri::command]
async fn ig_disconnect(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview_window("ig-scraper") {
        wv.clear_all_browsing_data()
            .map_err(|e| e.to_string())?;
        let _ = wv.close();
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
async fn fb_visit_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let wv = app
        .get_webview_window("fb-scraper")
        .ok_or_else(|| "fb-scraper window not found".to_string())?;

    wv.navigate(url.parse().map_err(|e: url::ParseError| e.to_string())?)
        .map_err(|e| e.to_string())?;

    tokio::time::sleep(Duration::from_secs(4)).await;
    Ok(())
}

/// Navigate the Instagram scraper WebView to a URL and wait for it to load.
/// Used by the outbox processor to mark posts as seen.
#[tauri::command]
async fn ig_visit_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let wv = app
        .get_webview_window("ig-scraper")
        .ok_or_else(|| "ig-scraper window not found".to_string())?;

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
async fn fb_like_post(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let wv = app
        .get_webview_window("fb-scraper")
        .ok_or_else(|| "fb-scraper window not found".to_string())?;

    wv.navigate(url.parse().map_err(|e: url::ParseError| e.to_string())?)
        .map_err(|e| e.to_string())?;

    tokio::time::sleep(Duration::from_secs(5)).await;

    wv.eval(r#"
        (function() {
            var btn = document.querySelector('[aria-label="Like"]')
                   || document.querySelector('[data-testid="like_button"]')
                   || document.querySelector('div[role="button"][aria-label*="Like"]');
            if (btn) { btn.click(); }
        })();
    "#).map_err(|e| e.to_string())?;

    info!("[FB] fb_like_post: injected like click for {}", url);

    tokio::time::sleep(Duration::from_millis(500)).await;
    Ok(())
}

/// Navigate to an Instagram post URL and click the Like button (best-effort).
///
/// Same best-effort semantics as `fb_like_post`. `wv.eval()` injects the
/// click script but cannot confirm whether the selector matched.
#[tauri::command]
async fn ig_like_post(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let wv = app
        .get_webview_window("ig-scraper")
        .ok_or_else(|| "ig-scraper window not found".to_string())?;

    wv.navigate(url.parse().map_err(|e: url::ParseError| e.to_string())?)
        .map_err(|e| e.to_string())?;

    tokio::time::sleep(Duration::from_secs(5)).await;

    wv.eval(r#"
        (function() {
            var btn = document.querySelector('[aria-label="Like"]')
                   || (document.querySelector('svg[aria-label="Like"]') || {}).closest
                      && document.querySelector('svg[aria-label="Like"]').closest('button')
                   || document.querySelector('button[type="button"][aria-label*="Like"]');
            if (btn) { btn.click(); }
        })();
    "#).map_err(|e| e.to_string())?;

    info!("[IG] ig_like_post: injected like click for {}", url);

    tokio::time::sleep(Duration::from_millis(500)).await;
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
                Err(
                    tokio_tungstenite::tungstenite::http::Response::builder()
                        .status(401)
                        .body(Some(
                            "Unauthorized: rescan the QR code to pair".to_owned(),
                        ))
                        .unwrap(),
                )
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
        if let Err(e) = ws_sender.send(Message::Binary(doc.into())).await {
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
                        let bytes = data.to_vec();
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
                    if let Err(e) = ws_sender.send(Message::Binary(doc.into())).await {
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

    let (broadcast_tx, _) = broadcast::channel::<Vec<u8>>(16);

    let relay_state = Arc::new(SyncRelayState {
        port: 8765,
        broadcast_tx,
        current_doc: RwLock::new(None),
        client_count: RwLock::new(0),
        // Populated from disk in .setup() before the relay starts accepting connections.
        pairing_token: StdRwLock::new(String::new()),
    });

    let relay_state_clone = relay_state.clone();

    tauri::Builder::default()
        // Structured file-based logging. Rotates at 10 MB, keeps the last 5 files.
        // Log location: ~/Library/Logs/freed/freed.log (macOS).
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(10 * 1024 * 1024)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .manage(relay_state)
        .manage(CaptureState::new())
        .setup(move |app| {
            let window = app.get_webview_window("main").unwrap();

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

            // Start mDNS advertisement and keep the daemon alive.
            let mdns_daemon = advertise_mdns(8765);
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
                    // Dev env var auto-scrape: show_window=true so the window is
                    // visible during development iteration.
                    let capture = auto_app.state::<CaptureState>();
                    match fb_scrape_feed(auto_app.clone(), capture, true).await {
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
                    // Dev env var auto-scrape: show_window=true so the window is
                    // visible during development iteration.
                    let capture = auto_app.state::<CaptureState>();
                    match ig_scrape_feed(auto_app.clone(), capture, true).await {
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
            fetch_url,
            x_api_request,
            get_local_ip,
            get_all_local_ips,
            get_sync_url,
            get_sync_client_count,
            broadcast_doc,
            reset_pairing_token,
            show_window,
            open_x_login_window,
            check_x_login_cookies,
            close_x_login_window,
            get_mdns_active,
            list_snapshots,
            start_oauth_server,
            pick_contact,
            fb_show_login,
            fb_hide_login,
            fb_check_auth,
            fb_scrape_feed,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Freed");
}
