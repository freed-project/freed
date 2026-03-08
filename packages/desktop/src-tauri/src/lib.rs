//! Freed Desktop Application
//!
//! Native desktop app that bundles capture, sync relay, and reader UI.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
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
        .map_err(|e| eprintln!("[mDNS] Failed to create daemon: {}", e))
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
    .map_err(|e| eprintln!("[mDNS] Failed to build ServiceInfo: {}", e))
    .ok()?;

    daemon
        .register(service)
        .map_err(|e| eprintln!("[mDNS] Failed to register service: {}", e))
        .ok()?;

    println!("[mDNS] Advertising _freed-sync._tcp.local on port {}", port);
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
        eprintln!("[Snapshot] Failed to create dir: {}", e);
        return;
    }

    let path = snapshot_dir.join(format!("freed-{}.automerge", ts));
    if let Err(e) = std::fs::write(&path, doc_bytes) {
        eprintln!("[Snapshot] Failed to write: {}", e);
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
    url: String,
    body: String,
    headers: std::collections::HashMap<String, String>,
    method: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36")
        // Bypass any HTTP/HTTPS proxy set via env vars (e.g. HTTPS_PROXY,
        // NO_PROXY). We need a direct connection so that:
        //   1. The native-tls TLS stack connects to x.com directly (no MITM).
        //   2. We don't leak auth cookies through a third-party proxy.
        .no_proxy()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

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
    println!("[Sync] Pairing token rotated");
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
                    eprintln!("[OAuth] Both listeners timed out or errored");
                    return;
                }
            };
            handle_oauth_stream(stream, app).await;
        });
    } else {
        tokio::spawn(async move {
            let Ok(stream) = rx.await else {
                eprintln!("[OAuth] Server timed out or failed to accept connection");
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
// Tauri commands — Facebook WebView scraper
// ---------------------------------------------------------------------------

/// The extraction script injected into the Facebook WebView after page load.
/// Reads posts from the rendered DOM and emits them via Tauri event IPC.
///
/// This is a self-contained script with no external dependencies.
/// It runs inside facebook.com's execution context.
const FB_EXTRACT_SCRIPT: &str = include_str!("fb-extract.js");

/// Real Safari UA to avoid Facebook detecting the bare WKWebView identifier
/// and serving a degraded/minimal feed experience.
const FB_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
    AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15";

/// Show a visible WebView window navigated to facebook.com/login so the
/// user can authenticate through the real Facebook login flow.
///
/// The window reuses the "fb-scraper" label. If it already exists it is
/// shown and focused; otherwise a new window is created.
///
/// An `on_navigation` handler detects when the user completes login
/// (URL leaves /login) and auto-hides the window + emits `fb-auth-result`.
#[tauri::command]
async fn fb_show_login(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    if let Some(existing) = app.get_webview_window("fb-scraper") {
        existing.navigate("https://www.facebook.com/login".parse().unwrap())
            .map_err(|e| e.to_string())?;
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    let app_handle = app.clone();

    WebviewWindowBuilder::new(
        &app,
        "fb-scraper",
        tauri::WebviewUrl::External("https://www.facebook.com/login".parse().unwrap()),
    )
    .user_agent(FB_USER_AGENT)
    .title("Connect Facebook — Freed")
    .inner_size(460.0, 700.0)
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
            .user_agent(FB_USER_AGENT)
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

/// Trigger a feed scrape in the hidden Facebook WebView.
///
/// Navigates to facebook.com, waits for content to render, then injects
/// the extraction script which reads the DOM and emits 'fb-feed-data'.
#[tauri::command]
async fn fb_scrape_feed(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    let fb_feed_url = "https://www.facebook.com/";

    let wv = match app.get_webview_window("fb-scraper") {
        Some(w) => {
            w.navigate(fb_feed_url.parse().unwrap())
                .map_err(|e| e.to_string())?;
            let _ = w.show();
            w
        }
        None => {
            let app_handle = app.clone();
            WebviewWindowBuilder::new(
                &app,
                "fb-scraper",
                tauri::WebviewUrl::External(
                    fb_feed_url.parse().unwrap(),
                ),
            )
            .user_agent(FB_USER_AGENT)
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
            })
            .build()
            .map_err(|e| e.to_string())?
        }
    };

    println!("[FB] scrape started, waiting for page load...");

    let jitter = {
        use rand::Rng;
        rand::thread_rng().gen_range(2000..4000)
    };
    tokio::time::sleep(Duration::from_millis(12000 + jitter)).await;

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

    // Facebook virtualizes its feed: posts only exist in the DOM when
    // they're near the viewport, and are unmounted when scrolled away.
    // We must scroll incrementally, extracting at each position.
    let num_passes = 12;
    for i in 0..num_passes {
        wv.eval(FB_EXTRACT_SCRIPT)
            .map_err(|e| format!("Failed to inject extraction script: {}", e))?;

        tokio::time::sleep(Duration::from_millis(300)).await;

        let scroll_amount = {
            use rand::Rng;
            rand::thread_rng().gen_range(300..500)
        };
        let scroll_js = format!(
            "window.scrollBy({{ top: {}, behavior: 'smooth' }});",
            scroll_amount
        );
        wv.eval(&scroll_js).map_err(|e| e.to_string())?;

        let pause = {
            use rand::Rng;
            rand::thread_rng().gen_range(2000..3500)
        };
        tokio::time::sleep(Duration::from_millis(pause)).await;

        println!("[FB] pass {}/{}: scrolled +{}px", i + 1, num_passes, scroll_amount);
    }

    wv.eval(FB_EXTRACT_SCRIPT)
        .map_err(|e| format!("Failed to inject extraction script: {}", e))?;

    tokio::time::sleep(Duration::from_millis(500)).await;
    println!("[FB] scrape complete, {} extraction passes emitted", num_passes + 1);

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

/// Safari UA to avoid Instagram detecting the bare WKWebView identifier
/// and serving a degraded experience.
const IG_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
    AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15";

/// Show a visible WebView window navigated to instagram.com/accounts/login
/// so the user can authenticate through the real Instagram login flow.
///
/// An `on_navigation` handler detects when the user completes login
/// (URL leaves /accounts/login) and auto-hides the window + emits
/// `ig-auth-result`.
#[tauri::command]
async fn ig_show_login(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    if let Some(existing) = app.get_webview_window("ig-scraper") {
        existing.navigate("https://www.instagram.com/accounts/login/".parse().unwrap())
            .map_err(|e| e.to_string())?;
        let _ = existing.show();
        let _ = existing.set_focus();
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
    .user_agent(IG_USER_AGENT)
    .title("Connect Instagram — Freed")
    .inner_size(460.0, 700.0)
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
                println!("[IG] login detected, auto-scraping in 3s...");
                tokio::time::sleep(Duration::from_secs(3)).await;
                match ig_scrape_feed(scrape_app).await {
                    Ok(()) => println!("[IG] post-login auto-scrape complete"),
                    Err(e) => println!("[IG] post-login auto-scrape error: {}", e),
                }
            });
        }

        true
    })
    .build()
    .map_err(|e| e.to_string())?;

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
            .user_agent(IG_USER_AGENT)
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
#[tauri::command]
async fn ig_scrape_feed(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    let ig_feed_url = "https://www.instagram.com/?variant=following";

    let wv = match app.get_webview_window("ig-scraper") {
        Some(w) => {
            // Window exists (user already logged in). Show it and let it load.
            // DO NOT re-navigate — that would fire the ig_show_login on_navigation
            // callback which hides the window, causing WebKit to throttle rendering.
            let _ = w.show();
            let _ = w.set_focus();
            println!("[IG] reusing existing ig-scraper window (already authenticated)");
            w
        }
        None => {
            // No existing window — create one. This path runs on first-ever scrape
            // (when the user hasn't gone through ig_show_login yet, e.g. auto-scrape).
            // Use a minimal on_navigation that only hides during the login page.
            let app_handle = app.clone();
            WebviewWindowBuilder::new(
                &app,
                "ig-scraper",
                tauri::WebviewUrl::External(
                    ig_feed_url.parse().unwrap(),
                ),
            )
            .user_agent(IG_USER_AGENT)
            .title("Freed Instagram")
            .inner_size(1280.0, 900.0)
            .visible(true)
            .on_navigation(move |url| {
                let path = url.path();
                let host = url.host_str().unwrap_or("");
                // Only emit auth result when moving away from login page
                if host.contains("instagram.com")
                    && (path == "/accounts/login" || path == "/accounts/login/")
                {
                    // Still on login — do nothing
                } else if host.contains("instagram.com") {
                    let _ = app_handle.emit("ig-auth-result",
                        serde_json::json!({ "loggedIn": true }));
                }
                true
            })
            .build()
            .map_err(|e| e.to_string())?
        }
    };

    println!("[IG] scrape started, waiting for feed to render...");

    let jitter = {
        use rand::Rng;
        rand::thread_rng().gen_range(2000..4000)
    };
    tokio::time::sleep(Duration::from_millis(8000 + jitter)).await;

    // Ensure window is still visible (anything could have hidden it)
    let _ = wv.show();
    let _ = wv.set_focus();
    println!("[IG] window visible, proceeding with extraction");

    // Belt-and-suspenders: click the Following tab if present
    let _ = wv.eval(r#"document.querySelector('a[href="/?variant=following"]')?.click();"#);
    tokio::time::sleep(Duration::from_millis(2000)).await;

    // Instagram virtualizes its feed similarly to Facebook. Scroll
    // incrementally, extracting at each position.
    let num_passes = 10;
    for i in 0..num_passes {
        // Keep window visible — WebKit throttles hidden windows
        let _ = wv.show();

        wv.eval(IG_EXTRACT_SCRIPT)
            .map_err(|e| format!("Failed to inject extraction script: {}", e))?;

        tokio::time::sleep(Duration::from_millis(300)).await;

        let scroll_amount = {
            use rand::Rng;
            rand::thread_rng().gen_range(400..700)
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

        let pause = {
            use rand::Rng;
            rand::thread_rng().gen_range(3500..5500)
        };
        tokio::time::sleep(Duration::from_millis(pause)).await;

        println!("[IG] pass {}/{}: scrolled +{}px", i + 1, num_passes, scroll_amount);
    }

    wv.eval(IG_EXTRACT_SCRIPT)
        .map_err(|e| format!("Failed to inject extraction script: {}", e))?;

    tokio::time::sleep(Duration::from_millis(500)).await;
    println!("[IG] scrape complete, {} extraction passes emitted", num_passes + 1);

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
    println!("[Sync] New connection from: {}", addr);

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
                eprintln!("[Sync] Rejected unauthorized connection from {}", addr);
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
                eprintln!("[Sync] WebSocket handshake failed: {}", e);
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
        println!("[Sync] Client connected. Total: {}", new_count);
        let _ = app.emit("sync-client-count", new_count);
    }

    // Push current doc to the new client immediately
    if let Some(doc) = state.current_doc.read().await.clone() {
        if let Err(e) = ws_sender.send(Message::Binary(doc.into())).await {
            eprintln!("[Sync] Failed to send initial doc: {}", e);
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
                        println!("[Sync] Client {} disconnected", addr);
                        break;
                    }
                    Some(Ok(Message::Ping(data))) => {
                        let _ = ws_sender.send(Message::Pong(data)).await;
                    }
                    Some(Err(e)) => {
                        eprintln!("[Sync] Error from {}: {}", addr, e);
                        break;
                    }
                    _ => {}
                }
            }
            broadcast = broadcast_rx.recv() => {
                if let Ok(doc) = broadcast {
                    if let Err(e) = ws_sender.send(Message::Binary(doc.into())).await {
                        eprintln!("[Sync] Failed to send to {}: {}", addr, e);
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
        println!("[Sync] Client disconnected. Total: {}", new_count);
        let _ = app.emit("sync-client-count", new_count);
    }
}

async fn start_sync_relay(state: RelayState, app: tauri::AppHandle) {
    let addr = format!("0.0.0.0:{}", state.port);

    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[Sync] Failed to bind to {}: {}", addr, e);
            return;
        }
    };

    println!("[Sync] Relay server listening on {}", addr);

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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .manage(relay_state)
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
                        println!("[FB] extraction error: {}", error);
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
                                println!("[FB]   #{}: [{}] {} — {:?}", total, strategy, author, text);
                            }
                        }
                    }

                    let total = fb_total_clone.load(Ordering::Relaxed);
                    println!("[FB] pass @ scrollY={}: candidates={}, new={}, total_unique={}",
                        scroll_y, candidates, new_count, total);
                }
            });

            app_for_fb.listen("fb-diag", |event| {
                let payload = event.payload();
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(payload) {
                    if let Ok(pretty) = serde_json::to_string_pretty(&val) {
                        println!("[FB] diag:\n{}", pretty);
                    } else {
                        println!("[FB] diag: {}", payload);
                    }
                } else {
                    println!("[FB] diag: {}", payload);
                }
            });

            let app_for_gql = app.handle().clone();
            app_for_gql.listen("fb-graphql", |event| {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                    let url = val.get("url").and_then(|u| u.as_str()).unwrap_or("?");
                    let size = val.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
                    let status = val.get("status").and_then(|s| s.as_u64()).unwrap_or(0);
                    let preview = val.get("preview").and_then(|p| p.as_str()).unwrap_or("");
                    println!("[FB-GQL] {} status={} size={} preview={:?}",
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
                        println!("[IG] extraction error: {}", error);
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
                                println!("[IG]   #{}: @{} — {:?}", total, author, text);
                            }
                        }
                    }

                    let total = ig_total_clone.load(Ordering::Relaxed);
                    let strategy = val.get("strategy").and_then(|s| s.as_str()).unwrap_or("?");
                    let url = val.get("url").and_then(|u| u.as_str()).unwrap_or("?");
                    println!("[IG] pass @ scrollY={}: candidates={}, new={}, total_unique={}, strategy={}, url={}",
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
                    println!("[FB] auto-scrape enabled, waiting 8s for app init...");
                    tokio::time::sleep(Duration::from_secs(8)).await;
                    println!("[FB] triggering auto-scrape now");
                    match fb_scrape_feed(auto_app).await {
                        Ok(()) => println!("[FB] auto-scrape command returned OK"),
                        Err(e) => println!("[FB] auto-scrape error: {}", e),
                    }
                });
            }

            // Dev-only: auto-trigger an Instagram scrape on startup so we can
            // iterate without manual clicking. Set IG_AUTO_SCRAPE=1 env var.
            if std::env::var("IG_AUTO_SCRAPE").unwrap_or_default() == "1" {
                let auto_app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    println!("[IG] auto-scrape enabled, waiting 8s for app init...");
                    tokio::time::sleep(Duration::from_secs(8)).await;
                    println!("[IG] triggering auto-scrape now");
                    match ig_scrape_feed(auto_app).await {
                        Ok(()) => println!("[IG] auto-scrape command returned OK"),
                        Err(e) => println!("[IG] auto-scrape error: {}", e),
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Freed");
}
