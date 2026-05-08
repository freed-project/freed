//! Freed Desktop Application
//!
//! Native desktop app that bundles capture, sync relay, and reader UI.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::{SinkExt, StreamExt};
use log::{error, info, warn};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::collections::{HashSet, VecDeque};
#[cfg(target_os = "macos")]
use std::mem::MaybeUninit;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex as StdMutex, RwLock as StdRwLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use sysinfo::{Disks, Pid, ProcessRefreshKind, ProcessesToUpdate, System};
#[cfg(target_os = "macos")]
use tauri::menu::Submenu;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Listener, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
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
use objc2::{msg_send, runtime::AnyObject};
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSApplication, NSApplicationActivationOptions, NSApplicationActivationPolicy,
    NSRunningApplication,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{ns_string, MainThreadMarker, NSObjectNSKeyValueCoding, NSString};
#[cfg(target_os = "macos")]
use objc2_web_kit::WKWebViewConfiguration;
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

const DEFAULT_SYNC_RELAY_PORT: u16 = 8765;
const MAIN_WINDOW_LABEL: &str = "main";
const MAIN_WINDOW_RECOVERY_KEEPALIVE_LABEL: &str = "main-recovery-keepalive";
const PRIMARY_MENU_ITEM_SHOW: &str = "show";
const PRIMARY_MENU_ITEM_QUIT: &str = "quit";

fn sync_relay_port() -> u16 {
    std::env::var("FREED_SYNC_PORT")
        .ok()
        .and_then(|raw| raw.parse::<u16>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(DEFAULT_SYNC_RELAY_PORT)
}

const DEFAULT_WEBKIT_SAFARI_UA: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15";
const SOCIAL_SCRAPER_WINDOW_LABELS: [&str; 3] = ["fb-scraper", "ig-scraper", "li-scraper"];
const FB_SCRAPER_DATA_STORE_IDENTIFIER: [u8; 16] = [
    0x66, 0x72, 0x65, 0x65, 0x64, 0xfb, 0x00, 0x01, 0x9a, 0x7d, 0x37, 0x01, 0x02, 0xfb, 0x00, 0x01,
];
const IG_SCRAPER_DATA_STORE_IDENTIFIER: [u8; 16] = [
    0x66, 0x72, 0x65, 0x65, 0x64, 0x1a, 0x00, 0x02, 0x9a, 0x7d, 0x37, 0x01, 0x02, 0x1a, 0x00, 0x02,
];
const LI_SCRAPER_DATA_STORE_IDENTIFIER: [u8; 16] = [
    0x66, 0x72, 0x65, 0x65, 0x64, 0x1d, 0x00, 0x03, 0x9a, 0x7d, 0x37, 0x01, 0x02, 0x1d, 0x00, 0x03,
];
const BYTES_PER_GIB: u64 = 1024 * 1024 * 1024;
const MIN_CRITICAL_MEMORY_BYTES: u64 = 7 * BYTES_PER_GIB / 2;
const MAX_CRITICAL_MEMORY_BYTES: u64 = 4 * BYTES_PER_GIB;
const WEBKIT_CACHE_TRIM_AT_BYTES: u64 = 768 * 1024 * 1024;
const WEBKIT_CACHE_TRIM_TARGET_BYTES: u64 = 512 * 1024 * 1024;
const OPTIONAL_STORY_MEMORY_BUDGET_PERCENT: u64 = 85;
const SCRAPE_MEMORY_HEADROOM_BYTES: u64 = 384 * 1024 * 1024;
const WEBKIT_PROCESS_START_GRACE_SECONDS: u64 = 10;
const STARTUP_RECOVERY_STATE_FILE: &str = "startup-recovery.json";
const RUNTIME_HEALTH_FILE: &str = "runtime-health.jsonl";
const RUNTIME_HEALTH_MAX_BYTES: u64 = 5 * 1024 * 1024;
const RUNTIME_DIAGNOSTICS_FILE: &str = "runtime-diagnostics.jsonl";
const RUNTIME_DIAGNOSTICS_MAX_BYTES: u64 = 5 * 1024 * 1024;
const RUNTIME_DIAGNOSTICS_COOLDOWN: Duration = Duration::from_secs(180);
const RECOVERY_WINDOW_LABEL: &str = "startup-recovery";
const RECOVERY_WINDOW_ROUTE: &str = "startup-recovery.html";
const RENDERER_HEARTBEAT_WATCHDOG_INTERVAL: Duration = Duration::from_secs(15);
const RENDERER_STALE_LOG_AFTER: Duration = Duration::from_secs(45);
const RENDERER_HIDDEN_STALE_LOG_AFTER: Duration = Duration::from_secs(480);
const RENDERER_VISIBLE_RECOVERY_AFTER: Duration = Duration::from_secs(75);
const RENDERER_HIDDEN_RECOVERY_AFTER: Duration = Duration::from_secs(600);
const BACKGROUND_REQUIRED_HEALTHY_HEARTBEATS: u64 = 2;
const BACKGROUND_RECOVERY_COOLDOWN: Duration = Duration::from_secs(120);
const BACKGROUND_MEMORY_HIGH_COOLDOWN: Duration = Duration::from_secs(120);
const BACKGROUND_MEMORY_CRITICAL_COOLDOWN: Duration = Duration::from_secs(10 * 60);
const BACKGROUND_SAFE_MODE_RECOVERY_WINDOW_SHORT: Duration = Duration::from_secs(10 * 60);
const BACKGROUND_SAFE_MODE_RECOVERY_WINDOW_LONG: Duration = Duration::from_secs(30 * 60);
const BACKGROUND_SAFE_MODE_DURATION: Duration = Duration::from_secs(10 * 60);
const BACKGROUND_SAFE_MODE_SHORT_LIMIT: usize = 2;
const BACKGROUND_SAFE_MODE_LONG_LIMIT: usize = 3;
const BACKGROUND_JOB_MAX_HELD: Duration = Duration::from_secs(120);
const FORCE_EXIT_AFTER_RESTART_REQUEST: Duration = Duration::from_secs(8);
const MAIN_WINDOW_RELEASE_POLL_INTERVAL: Duration = Duration::from_millis(50);
const MAIN_WINDOW_RELEASE_POLL_ATTEMPTS: usize = 100;
const MAIN_THREAD_WINDOW_STEP_TIMEOUT: Duration = Duration::from_secs(5);
const LOCAL_AI_DOWNLOAD_PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
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
const CLEANUP_BACKGROUND_SCRAPER_MEDIA_JS: &str = r#"
    (function() {
        try {
            var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 900;
            document.querySelectorAll('video,audio').forEach(function(node) {
                try {
                    node.pause();
                    node.removeAttribute('src');
                    node.querySelectorAll('source').forEach(function(source) {
                        source.removeAttribute('src');
                    });
                    node.load();
                } catch (_) {}
            });
            document.querySelectorAll('img[src],img[srcset]').forEach(function(img) {
                try {
                    var rect = img.getBoundingClientRect();
                    var isOffscreen = rect.bottom < -600 || rect.top > viewportHeight + 600;
                    if (!isOffscreen) return;
                    if (!img.dataset.freedCapturedSrc) {
                        img.dataset.freedCapturedSrc = img.currentSrc || img.src || "";
                    }
                    img.removeAttribute('src');
                    img.removeAttribute('srcset');
                } catch (_) {}
            });
        } catch (_) {}
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

fn social_scraper_data_store_identifier(label: &str) -> Option<[u8; 16]> {
    match label {
        "fb-scraper" => Some(FB_SCRAPER_DATA_STORE_IDENTIFIER),
        "ig-scraper" => Some(IG_SCRAPER_DATA_STORE_IDENTIFIER),
        "li-scraper" => Some(LI_SCRAPER_DATA_STORE_IDENTIFIER),
        _ => None,
    }
}

fn recycle_webview_window(app: &tauri::AppHandle, label: &str, reason: &str) {
    if let Some(window) = app.get_webview_window(label) {
        scrub_webview_before_destroy(&window);
        match window.destroy() {
            Ok(()) => info!("[window] recycled {} ({})", label, reason),
            Err(error) => error!(
                "[window] failed to recycle {} ({}): {}",
                label, reason, error
            ),
        }
    }
}

fn recycle_social_scraper_windows(app: &tauri::AppHandle, reason: &str) {
    for label in SOCIAL_SCRAPER_WINDOW_LABELS {
        recycle_webview_window(app, label, reason);
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

fn scrub_webview_before_destroy(window: &tauri::WebviewWindow) {
    let _ = window.eval(
        r#"
        (function() {
            try {
                for (var i = 1; i < 100000; i += 1) {
                    clearTimeout(i);
                    clearInterval(i);
                }
                document.querySelectorAll('video,audio').forEach(function(node) {
                    try {
                        node.pause();
                        node.removeAttribute('src');
                        node.load();
                    } catch (_) {}
                });
                if (document.body) document.body.textContent = '';
                if (window.stop) window.stop();
            } catch (_) {}
        })();
    "#,
    );
    let _ = window.navigate("about:blank".parse().unwrap());
}

fn build_hidden_scraper_window(
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
    .data_store_identifier(
        social_scraper_data_store_identifier(label)
            .expect("hidden scraper window labels must use isolated data stores"),
    )
    .user_agent(user_agent)
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
    .visible(false)
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

fn cleanup_background_scraper_media(window: &tauri::WebviewWindow) {
    let _ = window.eval(CLEANUP_BACKGROUND_SCRAPER_MEDIA_JS);
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

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
struct StartupRecoveryState {
    consecutive_failed_boots: u32,
    pending_boot_started_at_ms: Option<u64>,
    last_failed_boot_at_ms: Option<u64>,
    last_successful_boot_at_ms: Option<u64>,
}

#[derive(Default)]
struct LocalAIModelDownloadState(StdRwLock<HashSet<String>>);

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalAIModelFileDownloadRequest {
    download_id: String,
    url: String,
    target_path: String,
    partial_path: String,
    expected_size_bytes: u64,
    progress_event: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalAIModelFileDownloadProgress {
    download_id: String,
    downloaded_bytes: u64,
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn startup_recovery_state_path(data_dir: &Path) -> PathBuf {
    data_dir.join(STARTUP_RECOVERY_STATE_FILE)
}

#[cfg(target_os = "macos")]
fn clear_saved_window_state(app: &tauri::AppHandle) {
    let Some(home_dir) = std::env::var_os("HOME") else {
        return;
    };

    let bundle_id = &app.config().identifier;
    let saved_state_path = PathBuf::from(home_dir)
        .join("Library")
        .join("Saved Application State")
        .join(format!("{bundle_id}.savedState"));

    if !saved_state_path.exists() {
        return;
    }

    match std::fs::remove_dir_all(&saved_state_path) {
        Ok(()) => info!(
            "[main-window] cleared saved macOS window state at {}",
            saved_state_path.display()
        ),
        Err(error) => warn!(
            "[main-window] failed to clear saved macOS window state at {}: {}",
            saved_state_path.display(),
            error
        ),
    }
}

fn load_startup_recovery_state(data_dir: &Path) -> StartupRecoveryState {
    let path = startup_recovery_state_path(data_dir);
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return StartupRecoveryState::default();
    };

    match serde_json::from_str::<StartupRecoveryState>(&raw) {
        Ok(state) => state,
        Err(error) => {
            warn!(
                "[recovery] failed to parse startup recovery state at {}: {}",
                path.display(),
                error
            );
            StartupRecoveryState::default()
        }
    }
}

fn save_startup_recovery_state(data_dir: &Path, state: &StartupRecoveryState) {
    let path = startup_recovery_state_path(data_dir);
    let serialized = match serde_json::to_vec_pretty(state) {
        Ok(serialized) => serialized,
        Err(error) => {
            warn!(
                "[recovery] failed to serialize startup recovery state: {}",
                error
            );
            return;
        }
    };

    if let Err(error) = std::fs::write(&path, serialized) {
        warn!(
            "[recovery] failed to persist startup recovery state at {}: {}",
            path.display(),
            error
        );
    }
}

fn runtime_health_path(data_dir: &Path) -> PathBuf {
    data_dir.join(RUNTIME_HEALTH_FILE)
}

fn runtime_diagnostics_path(data_dir: &Path) -> PathBuf {
    data_dir.join(RUNTIME_DIAGNOSTICS_FILE)
}

fn append_bounded_jsonl(path: &Path, line: &str, max_bytes: u64) -> std::io::Result<()> {
    if let Ok(metadata) = std::fs::metadata(path) {
        if metadata.len() > max_bytes {
            let existing = std::fs::read_to_string(path).unwrap_or_default();
            let keep_from = existing.len().saturating_sub((max_bytes / 2) as usize);
            let keep = existing
                .get(keep_from..)
                .and_then(|tail| tail.find('\n').map(|offset| &tail[offset + 1..]))
                .unwrap_or("");
            std::fs::write(path, keep)?;
        }
    }

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    use std::io::Write;
    writeln!(file, "{}", line)
}

fn append_runtime_health(app: &tauri::AppHandle, mut payload: serde_json::Value) {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
    std::fs::create_dir_all(&data_dir).ok();

    if let serde_json::Value::Object(fields) = &mut payload {
        fields.insert("tsMs".to_string(), serde_json::json!(now_unix_ms()));
    }

    let Ok(line) = serde_json::to_string(&payload) else {
        return;
    };
    let path = runtime_health_path(&data_dir);
    if let Err(error) = append_bounded_jsonl(&path, &line, RUNTIME_HEALTH_MAX_BYTES) {
        warn!(
            "[runtime-health] failed to append {}: {}",
            path.display(),
            error
        );
    }
}

static LAST_DEEP_DIAGNOSTIC_AT: StdMutex<Option<Instant>> = StdMutex::new(None);

fn command_output_truncated(command: &str, args: &[String], max_chars: usize) -> Option<String> {
    let output = Command::new(command).args(args).output().ok()?;
    let combined = if output.status.success() {
        output.stdout
    } else {
        [output.stdout, output.stderr].concat()
    };
    let raw = String::from_utf8_lossy(&combined);
    Some(truncate_for_log(&raw, max_chars))
}

fn capture_deep_runtime_diagnostic(
    app: &tauri::AppHandle,
    trigger: &str,
    reason: &str,
    stats: &RuntimeMemoryStats,
    active_background_job: Option<&'static str>,
    active_background_job_age_ms: Option<u128>,
    force: bool,
) {
    let now = Instant::now();
    {
        let mut last = LAST_DEEP_DIAGNOSTIC_AT.lock().unwrap();
        if !force
            && last
                .map(|last| now.duration_since(last) < RUNTIME_DIAGNOSTICS_COOLDOWN)
                .unwrap_or(false)
        {
            return;
        }
        *last = Some(now);
    }

    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
    std::fs::create_dir_all(&data_dir).ok();

    let labels = serde_json::json!({
        "main": app.get_webview_window(MAIN_WINDOW_LABEL).is_some(),
        "recoveryKeepalive": app.get_webview_window(MAIN_WINDOW_RECOVERY_KEEPALIVE_LABEL).is_some(),
        "facebookScraper": app.get_webview_window("fb-scraper").is_some(),
        "instagramScraper": app.get_webview_window("ig-scraper").is_some(),
        "linkedinScraper": app.get_webview_window("li-scraper").is_some()
    });
    #[cfg(target_os = "macos")]
    let vmmap_summary = stats.webkit_largest_process_id.and_then(|pid| {
        command_output_truncated(
            "/usr/bin/vmmap",
            &["-summary".to_string(), pid.to_string()],
            24_000,
        )
    });
    #[cfg(not(target_os = "macos"))]
    let vmmap_summary: Option<String> = None;

    #[cfg(target_os = "macos")]
    let sample_summary = stats.webkit_largest_process_id.and_then(|pid| {
        command_output_truncated(
            "/usr/bin/sample",
            &[pid.to_string(), "1".to_string()],
            24_000,
        )
    });
    #[cfg(not(target_os = "macos"))]
    let sample_summary: Option<String> = None;

    let mut payload = serde_json::json!({
        "tsMs": now_unix_ms(),
        "trigger": trigger,
        "reason": reason,
        "activeBackgroundJob": active_background_job,
        "activeBackgroundJobAgeMs": active_background_job_age_ms,
        "webviewLabels": labels,
        "memory": stats,
        "vmmapSummary": vmmap_summary,
        "sampleSummary": sample_summary
    });

    if let serde_json::Value::Object(fields) = &mut payload {
        if let Ok(cache_dir) = app.path().app_cache_dir() {
            fields.insert(
                "cacheDirBytes".to_string(),
                serde_json::json!(dir_size_bytes(&cache_dir)),
            );
        }
        if let Ok(app_data_dir) = app.path().app_data_dir() {
            fields.insert(
                "snapshotsBytes".to_string(),
                serde_json::json!(dir_size_bytes(&app_data_dir.join("snapshots"))),
            );
            fields.insert(
                "contentBytes".to_string(),
                serde_json::json!(dir_size_bytes(&app_data_dir.join("content"))),
            );
            fields.insert(
                "localAiModelsBytes".to_string(),
                serde_json::json!(dir_size_bytes(&app_data_dir.join("local-ai-models"))),
            );
        }
    }

    let Ok(line) = serde_json::to_string(&payload) else {
        return;
    };
    let path = runtime_diagnostics_path(&data_dir);
    if let Err(error) = append_bounded_jsonl(&path, &line, RUNTIME_DIAGNOSTICS_MAX_BYTES) {
        warn!(
            "[runtime-diagnostics] failed to append {}: {}",
            path.display(),
            error
        );
    }
}

fn reconcile_startup_recovery_state(data_dir: &Path) -> StartupRecoveryState {
    let mut state = load_startup_recovery_state(data_dir);

    if state.pending_boot_started_at_ms.take().is_some() {
        state.consecutive_failed_boots = state.consecutive_failed_boots.saturating_add(1);
        state.last_failed_boot_at_ms = Some(now_unix_ms());
        save_startup_recovery_state(data_dir, &state);
        warn!(
            "[recovery] detected unfinished startup, consecutive_failed_boots={}",
            state.consecutive_failed_boots
        );
    }

    state
}

fn mark_startup_failed(data_dir: &Path) {
    let mut state = load_startup_recovery_state(data_dir);
    state.pending_boot_started_at_ms = None;
    state.consecutive_failed_boots = state.consecutive_failed_boots.saturating_add(1);
    state.last_failed_boot_at_ms = Some(now_unix_ms());
    save_startup_recovery_state(data_dir, &state);
}

fn mark_startup_pending(data_dir: &Path) {
    let mut state = load_startup_recovery_state(data_dir);
    state.pending_boot_started_at_ms = Some(now_unix_ms());
    save_startup_recovery_state(data_dir, &state);
}

fn mark_startup_success(data_dir: &Path) {
    let mut state = load_startup_recovery_state(data_dir);
    if state.pending_boot_started_at_ms.is_none() && state.consecutive_failed_boots == 0 {
        return;
    }

    state.pending_boot_started_at_ms = None;
    state.consecutive_failed_boots = 0;
    state.last_successful_boot_at_ms = Some(now_unix_ms());
    save_startup_recovery_state(data_dir, &state);
    info!("[recovery] renderer reached healthy startup state");
}

fn startup_requires_recovery(state: &StartupRecoveryState) -> bool {
    state.consecutive_failed_boots > 0
}

fn open_or_focus_recovery_window(
    app: &tauri::AppHandle,
) -> Result<tauri::WebviewWindow, tauri::Error> {
    if let Some(window) = app.get_webview_window(RECOVERY_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(window);
    }

    let window = tauri::WebviewWindowBuilder::new(
        app,
        RECOVERY_WINDOW_LABEL,
        tauri::WebviewUrl::App(RECOVERY_WINDOW_ROUTE.into()),
    )
    .title("Freed")
    .inner_size(560.0, 520.0)
    .min_inner_size(480.0, 420.0)
    .center()
    .resizable(true)
    .focused(true)
    .build()?;

    #[cfg(target_os = "macos")]
    disable_window_restoration(&window);

    let _ = window.show();
    let _ = window.set_focus();
    Ok(window)
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
    total_physical_memory_bytes: u64,
    process_resident_bytes: u64,
    process_footprint_bytes: Option<u64>,
    process_virtual_bytes: u64,
    app_resident_bytes: u64,
    app_memory_pressure_bytes: u64,
    webkit_resident_bytes: Option<u64>,
    webkit_footprint_bytes: Option<u64>,
    webkit_virtual_bytes: Option<u64>,
    webkit_process_id: Option<u32>,
    webkit_total_resident_bytes: u64,
    webkit_total_footprint_bytes: Option<u64>,
    webkit_process_count: u64,
    webkit_largest_resident_bytes: Option<u64>,
    webkit_largest_footprint_bytes: Option<u64>,
    webkit_largest_process_id: Option<u32>,
    webkit_largest_cpu_usage: Option<f32>,
    webkit_largest_age_seconds: Option<u64>,
    webkit_largest_role: Option<String>,
    webkit_processes: Vec<WebkitProcessRuntimeStats>,
    webkit_telemetry_available: bool,
    indexed_db_bytes: Option<u64>,
    webkit_cache_bytes: Option<u64>,
    memory_high_bytes: u64,
    memory_critical_bytes: u64,
    relay_doc_bytes: u64,
    relay_client_count: u64,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WebkitProcessRuntimeStats {
    process_id: u32,
    resident_bytes: u64,
    footprint_bytes: Option<u64>,
    virtual_bytes: u64,
    cpu_usage: f32,
    age_seconds: u64,
    role: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AIHardwareProfile {
    total_memory_bytes: Option<u64>,
    available_memory_bytes: Option<u64>,
    available_app_data_bytes: Option<u64>,
    os: String,
    arch: String,
    web_gpu_available: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ScrapeMemoryPreparation {
    before: RuntimeMemoryStats,
    after: RuntimeMemoryStats,
    recycled_scraper_windows: bool,
    cache_trimmed: bool,
    scrape_start_budget_bytes: u64,
    may_proceed: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WebkitCacheTrimResult {
    before_bytes: u64,
    after_bytes: u64,
    cache_trimmed: bool,
}

struct WebkitMemoryStats {
    total_resident_bytes: u64,
    total_footprint_bytes: Option<u64>,
    process_count: u64,
    largest_resident_bytes: Option<u64>,
    largest_footprint_bytes: Option<u64>,
    largest_virtual_bytes: Option<u64>,
    largest_process_id: Option<u32>,
    largest_cpu_usage: Option<f32>,
    largest_age_seconds: Option<u64>,
    largest_role: Option<String>,
    processes: Vec<WebkitProcessRuntimeStats>,
}

#[derive(Debug, Clone)]
struct ActiveBackgroundJob {
    operation: &'static str,
    started_at: Instant,
}

#[derive(Debug)]
struct BackgroundRuntimeState {
    healthy_heartbeats: u64,
    renderer_stale: bool,
    cooldown_until: Option<Instant>,
    memory_cooldown_until: Option<Instant>,
    safe_mode_until: Option<Instant>,
    recovery_history: VecDeque<Instant>,
    active_job: Option<ActiveBackgroundJob>,
    last_recovery_reason: Option<String>,
    last_memory_pressure_reason: Option<String>,
}

impl BackgroundRuntimeState {
    fn new() -> Self {
        Self {
            healthy_heartbeats: 0,
            renderer_stale: true,
            cooldown_until: None,
            memory_cooldown_until: None,
            safe_mode_until: None,
            recovery_history: VecDeque::new(),
            active_job: None,
            last_recovery_reason: None,
            last_memory_pressure_reason: None,
        }
    }
}

#[derive(Debug)]
struct BackgroundRuntimeCoordinator {
    state: StdRwLock<BackgroundRuntimeState>,
}

impl BackgroundRuntimeCoordinator {
    fn new() -> Self {
        Self {
            state: StdRwLock::new(BackgroundRuntimeState::new()),
        }
    }

    fn note_renderer_heartbeat(&self) {
        let mut state = self.state.write().unwrap();
        state.healthy_heartbeats = state.healthy_heartbeats.saturating_add(1);
        if state.healthy_heartbeats >= BACKGROUND_REQUIRED_HEALTHY_HEARTBEATS {
            state.renderer_stale = false;
        }
    }

    fn note_renderer_stale(&self, reason: &str) {
        let mut state = self.state.write().unwrap();
        state.renderer_stale = true;
        state.cooldown_until = Some(Instant::now() + BACKGROUND_RECOVERY_COOLDOWN);
        state.last_recovery_reason = Some(reason.to_string());
    }

    fn note_renderer_recovery_attempt(&self, reason: &str) {
        let now = Instant::now();
        let mut state = self.state.write().unwrap();
        state.healthy_heartbeats = 0;
        state.renderer_stale = true;
        state.cooldown_until = Some(now + BACKGROUND_RECOVERY_COOLDOWN);
        state.last_recovery_reason = Some(reason.to_string());
        state.recovery_history.push_back(now);
        while state
            .recovery_history
            .front()
            .map(|oldest| now.duration_since(*oldest) > BACKGROUND_SAFE_MODE_RECOVERY_WINDOW_LONG)
            .unwrap_or(false)
        {
            state.recovery_history.pop_front();
        }

        let recoveries_in_short_window = state
            .recovery_history
            .iter()
            .filter(|recovery_at| {
                now.duration_since(**recovery_at) <= BACKGROUND_SAFE_MODE_RECOVERY_WINDOW_SHORT
            })
            .count();
        if recoveries_in_short_window >= BACKGROUND_SAFE_MODE_SHORT_LIMIT
            || state.recovery_history.len() >= BACKGROUND_SAFE_MODE_LONG_LIMIT
        {
            state.safe_mode_until = Some(now + BACKGROUND_SAFE_MODE_DURATION);
        }
    }

    fn note_memory_pressure(&self, provider: &str, operation: &str, critical: bool) -> u128 {
        let now = Instant::now();
        let cooldown = if critical {
            BACKGROUND_MEMORY_CRITICAL_COOLDOWN
        } else {
            BACKGROUND_MEMORY_HIGH_COOLDOWN
        };
        let mut state = self.state.write().unwrap();
        let until = now + cooldown;
        if state
            .memory_cooldown_until
            .map(|current| current < until)
            .unwrap_or(true)
        {
            state.memory_cooldown_until = Some(until);
        }
        state.last_memory_pressure_reason = Some(format!(
            "{} {} memory pressure {}",
            provider,
            operation,
            if critical { "critical" } else { "high" }
        ));
        state
            .memory_cooldown_until
            .and_then(|until| {
                if until > now {
                    Some(until.duration_since(now).as_millis())
                } else {
                    None
                }
            })
            .unwrap_or(0)
    }

    fn begin_job(&self, operation: &'static str) -> Result<(), String> {
        let now = Instant::now();
        let mut state = self.state.write().unwrap();

        if state.healthy_heartbeats < BACKGROUND_REQUIRED_HEALTHY_HEARTBEATS {
            return Err(format!(
                "background work is waiting for {} healthy renderer heartbeats",
                BACKGROUND_REQUIRED_HEALTHY_HEARTBEATS
            ));
        }

        if state.renderer_stale {
            return Err("background work is paused while the renderer is stale".to_string());
        }

        if let Some(cooldown_until) = state.cooldown_until {
            if cooldown_until > now {
                let wait_ms = cooldown_until.duration_since(now).as_millis();
                return Err(format!(
                    "background work is cooling down for {} ms after renderer recovery",
                    wait_ms
                ));
            }
            state.cooldown_until = None;
        }

        if let Some(memory_cooldown_until) = state.memory_cooldown_until {
            if memory_cooldown_until > now {
                let wait_ms = memory_cooldown_until.duration_since(now).as_millis();
                let reason = state
                    .last_memory_pressure_reason
                    .as_deref()
                    .unwrap_or("recent memory pressure");
                return Err(format!(
                    "background work is cooling down for {} ms after {}",
                    wait_ms, reason
                ));
            }
            state.memory_cooldown_until = None;
            state.last_memory_pressure_reason = None;
        }

        if let Some(safe_mode_until) = state.safe_mode_until {
            if safe_mode_until > now {
                let wait_ms = safe_mode_until.duration_since(now).as_millis();
                return Err(format!(
                    "background work is paused for {} ms while renderer safe mode is active",
                    wait_ms
                ));
            }
            state.safe_mode_until = None;
        }

        if let Some(active) = &state.active_job {
            return Err(format!(
                "background job {} is already active",
                active.operation
            ));
        }

        state.active_job = Some(ActiveBackgroundJob {
            operation,
            started_at: now,
        });
        Ok(())
    }

    fn finish_job(&self, operation: &'static str) -> Option<u128> {
        let mut state = self.state.write().unwrap();
        let Some(active) = state.active_job.take() else {
            return None;
        };
        if active.operation != operation {
            warn!(
                "[background-runtime] finishing op={} while active_op={}",
                operation, active.operation
            );
        }
        Some(active.started_at.elapsed().as_millis())
    }

    fn active_job_for_health(&self) -> (Option<&'static str>, Option<u128>) {
        let state = self.state.read().unwrap();
        state
            .active_job
            .as_ref()
            .map(|job| {
                (
                    Some(job.operation),
                    Some(job.started_at.elapsed().as_millis()),
                )
            })
            .unwrap_or((None, None))
    }

    fn recovery_status_for_health(&self) -> (bool, Option<u128>, usize, usize) {
        let now = Instant::now();
        let state = self.state.read().unwrap();
        let safe_mode_remaining_ms = state.safe_mode_until.and_then(|until| {
            if until > now {
                Some(until.duration_since(now).as_millis())
            } else {
                None
            }
        });
        let recoveries_in_short_window = state
            .recovery_history
            .iter()
            .filter(|recovery_at| {
                now.duration_since(**recovery_at) <= BACKGROUND_SAFE_MODE_RECOVERY_WINDOW_SHORT
            })
            .count();

        (
            safe_mode_remaining_ms.is_some(),
            safe_mode_remaining_ms,
            recoveries_in_short_window,
            state.recovery_history.len(),
        )
    }
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
    background_runtime: Arc<BackgroundRuntimeCoordinator>,
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
            background_runtime: Arc::new(BackgroundRuntimeCoordinator::new()),
            x_client,
        }
    }
}

struct ActiveScraperSession {
    _guard: tokio::sync::OwnedMutexGuard<()>,
    background_runtime: Arc<BackgroundRuntimeCoordinator>,
    operation: &'static str,
    acquired_at: std::time::Instant,
}

impl Drop for ActiveScraperSession {
    fn drop(&mut self) {
        let runtime_held_ms = self
            .background_runtime
            .finish_job(self.operation)
            .unwrap_or_else(|| self.acquired_at.elapsed().as_millis());
        if runtime_held_ms > BACKGROUND_JOB_MAX_HELD.as_millis() {
            warn!(
                "[background-runtime] scraper op={} exceeded max_held_ms={} held_ms={}",
                self.operation,
                BACKGROUND_JOB_MAX_HELD.as_millis(),
                runtime_held_ms
            );
        }
        info!(
            "[scraper] released session op={} held_ms={}",
            self.operation,
            self.acquired_at.elapsed().as_millis()
        );
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RendererHeartbeatPayload {
    seq: u64,
    ts: u64,
    reason: String,
    visibility: String,
    href: String,
    page_load_id: Option<String>,
    uptime_ms: Option<u64>,
    app_phase: Option<String>,
    event_loop_lag_ms: Option<f64>,
    dom_node_count: Option<u64>,
    renderer_heap_used_bytes: Option<u64>,
    renderer_heap_total_bytes: Option<u64>,
    last_input_age_ms: Option<u64>,
    settings_open: Option<bool>,
    dialog_open: Option<bool>,
}

struct RendererHeartbeatStatus {
    started_at: std::time::Instant,
    last_seen_at: Option<std::time::Instant>,
    last_seq: u64,
    last_reason: String,
    last_visibility: String,
    last_href: String,
    last_page_load_id: Option<String>,
    last_uptime_ms: Option<u64>,
    last_app_phase: Option<String>,
    last_event_loop_lag_ms: Option<f64>,
    last_dom_node_count: Option<u64>,
    last_renderer_heap_used_bytes: Option<u64>,
    last_renderer_heap_total_bytes: Option<u64>,
    last_input_age_ms: Option<u64>,
    last_settings_open: Option<bool>,
    last_dialog_open: Option<bool>,
    stale_logged: bool,
    recovery_attempts: u64,
    last_recovery_at: Option<std::time::Instant>,
    renderer_generation: u64,
    recovery_history: VecDeque<std::time::Instant>,
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
            last_page_load_id: None,
            last_uptime_ms: None,
            last_app_phase: None,
            last_event_loop_lag_ms: None,
            last_dom_node_count: None,
            last_renderer_heap_used_bytes: None,
            last_renderer_heap_total_bytes: None,
            last_input_age_ms: None,
            last_settings_open: None,
            last_dialog_open: None,
            stale_logged: false,
            recovery_attempts: 0,
            last_recovery_at: None,
            renderer_generation: 1,
            recovery_history: VecDeque::new(),
        }
    }

    fn note_heartbeat(
        &mut self,
        payload: &RendererHeartbeatPayload,
        now: std::time::Instant,
    ) -> (bool, u128, bool) {
        let first_heartbeat = self.last_seen_at.is_none();
        let gap_ms = self
            .last_seen_at
            .map(|last| now.duration_since(last).as_millis())
            .unwrap_or_else(|| now.duration_since(self.started_at).as_millis());
        let recovered = self.stale_logged || self.recovery_attempts > 0;

        self.last_seen_at = Some(now);
        self.last_seq = payload.seq;
        self.last_reason = payload.reason.clone();
        self.last_visibility = payload.visibility.clone();
        self.last_href = payload.href.clone();
        self.last_page_load_id = payload.page_load_id.clone();
        self.last_uptime_ms = payload.uptime_ms;
        self.last_app_phase = payload.app_phase.clone();
        self.last_event_loop_lag_ms = payload.event_loop_lag_ms;
        self.last_dom_node_count = payload.dom_node_count;
        self.last_renderer_heap_used_bytes = payload.renderer_heap_used_bytes;
        self.last_renderer_heap_total_bytes = payload.renderer_heap_total_bytes;
        self.last_input_age_ms = payload.last_input_age_ms;
        self.last_settings_open = payload.settings_open;
        self.last_dialog_open = payload.dialog_open;
        self.stale_logged = false;
        self.recovery_attempts = 0;
        self.last_recovery_at = None;

        (first_heartbeat, gap_ms, recovered)
    }

    fn note_recovery_attempt(&mut self, now: std::time::Instant) -> u64 {
        self.started_at = now;
        self.last_seen_at = None;
        self.last_seq = 0;
        self.last_reason = "native-recovery".to_string();
        self.last_visibility = "unknown".to_string();
        self.last_href = String::new();
        self.last_page_load_id = None;
        self.last_uptime_ms = None;
        self.last_app_phase = None;
        self.last_event_loop_lag_ms = None;
        self.last_dom_node_count = None;
        self.last_renderer_heap_used_bytes = None;
        self.last_renderer_heap_total_bytes = None;
        self.last_input_age_ms = None;
        self.last_settings_open = None;
        self.last_dialog_open = None;
        self.stale_logged = false;
        self.recovery_attempts += 1;
        self.last_recovery_at = Some(now);
        self.renderer_generation = self.renderer_generation.saturating_add(1);
        self.recovery_history.push_back(now);
        while self
            .recovery_history
            .front()
            .map(|oldest| now.duration_since(*oldest) > BACKGROUND_SAFE_MODE_RECOVERY_WINDOW_LONG)
            .unwrap_or(false)
        {
            self.recovery_history.pop_front();
        }
        self.recovery_attempts
    }

    fn recent_recovery_count(&self, window: Duration) -> usize {
        let now = Instant::now();
        self.recovery_history
            .iter()
            .filter(|recovery_at| now.duration_since(**recovery_at) <= window)
            .count()
    }
}

#[cfg(test)]
fn renderer_recovery_threshold(is_visible: bool, last_visibility: &str) -> Duration {
    renderer_recovery_threshold_for_count(is_visible, last_visibility, 0)
}

fn renderer_recovery_threshold_for_count(
    is_visible: bool,
    last_visibility: &str,
    recent_recovery_count: usize,
) -> Duration {
    if renderer_is_effectively_visible(is_visible, last_visibility) {
        match recent_recovery_count {
            0 | 1 => RENDERER_VISIBLE_RECOVERY_AFTER,
            2 => Duration::from_secs(120),
            _ => Duration::from_secs(300),
        }
    } else {
        RENDERER_HIDDEN_RECOVERY_AFTER
    }
}

fn renderer_is_effectively_visible(is_visible: bool, last_visibility: &str) -> bool {
    is_visible && last_visibility == "visible"
}

fn renderer_stale_log_after(is_visible: bool, last_visibility: &str) -> Duration {
    if renderer_is_effectively_visible(is_visible, last_visibility) {
        RENDERER_STALE_LOG_AFTER
    } else {
        RENDERER_HIDDEN_STALE_LOG_AFTER
    }
}

fn renderer_stale_log_should_pause_background(is_visible: bool, last_visibility: &str) -> bool {
    renderer_is_effectively_visible(is_visible, last_visibility)
}

fn renderer_stale_log_should_capture_deep_diagnostic(
    is_visible: bool,
    last_visibility: &str,
) -> bool {
    renderer_is_effectively_visible(is_visible, last_visibility)
}

fn renderer_stale_should_recover(is_visible: bool, last_visibility: &str) -> bool {
    renderer_is_effectively_visible(is_visible, last_visibility)
}

fn format_bytes_for_log(bytes: u64) -> String {
    const KIB: f64 = 1024.0;
    const MIB: f64 = KIB * 1024.0;
    const GIB: f64 = MIB * 1024.0;

    let bytes_f = bytes as f64;
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes_f / KIB)
    } else if bytes < 1024 * 1024 * 1024 {
        format!("{:.1} MB", bytes_f / MIB)
    } else {
        format!("{:.2} GB", bytes_f / GIB)
    }
}

#[cfg(test)]
mod renderer_watchdog_tests {
    use super::*;

    #[test]
    fn renderer_recovery_threshold_prefers_visible_windows() {
        assert_eq!(
            renderer_recovery_threshold(true, "hidden"),
            RENDERER_HIDDEN_RECOVERY_AFTER
        );
        assert_eq!(
            renderer_recovery_threshold(false, "visible"),
            RENDERER_HIDDEN_RECOVERY_AFTER
        );
        assert_eq!(
            renderer_recovery_threshold(false, "hidden"),
            RENDERER_HIDDEN_RECOVERY_AFTER
        );
        assert_eq!(
            renderer_recovery_threshold(true, "visible"),
            RENDERER_VISIBLE_RECOVERY_AFTER
        );
    }

    #[test]
    fn renderer_stale_log_threshold_uses_hidden_timer_slack() {
        assert_eq!(
            renderer_stale_log_after(true, "visible"),
            RENDERER_STALE_LOG_AFTER
        );
        assert_eq!(
            renderer_stale_log_after(true, "hidden"),
            RENDERER_HIDDEN_STALE_LOG_AFTER
        );
        assert_eq!(
            renderer_stale_log_after(false, "visible"),
            RENDERER_HIDDEN_STALE_LOG_AFTER
        );
    }

    #[test]
    fn hidden_renderer_stale_log_waits_past_webkit_timer_throttling() {
        assert!(RENDERER_HIDDEN_STALE_LOG_AFTER > Duration::from_secs(300));
        assert!(RENDERER_HIDDEN_STALE_LOG_AFTER < RENDERER_HIDDEN_RECOVERY_AFTER);
    }

    #[test]
    fn hidden_renderer_stale_log_keeps_background_work_eligible() {
        assert!(renderer_stale_log_should_pause_background(true, "visible"));
        assert!(!renderer_stale_log_should_pause_background(true, "hidden"));
        assert!(!renderer_stale_log_should_pause_background(
            false, "visible"
        ));
        assert!(!renderer_stale_log_should_pause_background(false, "hidden"));
    }

    #[test]
    fn hidden_renderer_stale_log_skips_deep_diagnostics() {
        assert!(renderer_stale_log_should_capture_deep_diagnostic(
            true, "visible"
        ));
        assert!(!renderer_stale_log_should_capture_deep_diagnostic(
            true, "hidden"
        ));
        assert!(!renderer_stale_log_should_capture_deep_diagnostic(
            false, "visible"
        ));
        assert!(!renderer_stale_log_should_capture_deep_diagnostic(
            false, "hidden"
        ));
    }

    #[test]
    fn hidden_renderer_stale_skips_renderer_recovery() {
        assert!(renderer_stale_should_recover(true, "visible"));
        assert!(!renderer_stale_should_recover(true, "hidden"));
        assert!(!renderer_stale_should_recover(false, "visible"));
        assert!(!renderer_stale_should_recover(false, "hidden"));
    }

    #[test]
    fn main_window_release_timeout_allows_main_loop_to_unregister_label() {
        assert_eq!(main_window_release_timeout_ms(), 5_000);
    }

    #[test]
    fn heartbeat_after_recovery_resets_recovery_state() {
        let mut status = RendererHeartbeatStatus::new();
        let attempt = status.note_recovery_attempt(std::time::Instant::now());
        assert_eq!(attempt, 1);
        assert_eq!(status.recovery_attempts, 1);

        let payload = RendererHeartbeatPayload {
            seq: 7,
            ts: 1_777_000_000_000,
            reason: "startup".to_string(),
            visibility: "visible".to_string(),
            href: "tauri://localhost".to_string(),
            page_load_id: Some("page-1".to_string()),
            uptime_ms: Some(1_000),
            app_phase: Some("ready".to_string()),
            event_loop_lag_ms: Some(4.0),
            dom_node_count: Some(100),
            renderer_heap_used_bytes: Some(1024),
            renderer_heap_total_bytes: Some(2048),
            last_input_age_ms: Some(50),
            settings_open: Some(false),
            dialog_open: Some(false),
        };
        let (_first_heartbeat, _gap_ms, recovered) =
            status.note_heartbeat(&payload, std::time::Instant::now());

        assert!(recovered);
        assert_eq!(status.recovery_attempts, 0);
        assert!(status.last_recovery_at.is_none());
        assert_eq!(status.last_seq, 7);
        assert_eq!(status.last_page_load_id.as_deref(), Some("page-1"));
    }

    #[test]
    fn visible_renderer_recovery_backs_off_after_repeated_recoveries() {
        assert_eq!(
            renderer_recovery_threshold_for_count(true, "visible", 0),
            RENDERER_VISIBLE_RECOVERY_AFTER
        );
        assert_eq!(
            renderer_recovery_threshold_for_count(true, "visible", 2),
            Duration::from_secs(120)
        );
        assert_eq!(
            renderer_recovery_threshold_for_count(true, "visible", 3),
            Duration::from_secs(300)
        );
    }

    #[test]
    fn background_runtime_enters_safe_mode_after_repeated_recoveries() {
        let runtime = BackgroundRuntimeCoordinator::new();
        runtime.note_renderer_heartbeat();
        runtime.note_renderer_heartbeat();

        runtime.note_renderer_recovery_attempt("renderer heartbeat stale");
        runtime.note_renderer_recovery_attempt("renderer heartbeat stale");

        let (safe_mode_active, safe_mode_remaining_ms, recoveries_short, recoveries_long) =
            runtime.recovery_status_for_health();
        assert!(safe_mode_active);
        assert!(safe_mode_remaining_ms.unwrap_or(0) > 0);
        assert_eq!(recoveries_short, 2);
        assert_eq!(recoveries_long, 2);
        assert!(runtime.begin_job("fb_scrape_feed").is_err());
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
) -> Result<ActiveScraperSession, String> {
    let session = capture.scraper_session.clone();

    match session.clone().try_lock_owned() {
        Ok(guard) => {
            capture.background_runtime.begin_job(operation)?;
            info!("[scraper] acquired session op={} wait_ms=0", operation);
            Ok(ActiveScraperSession {
                _guard: guard,
                background_runtime: capture.background_runtime.clone(),
                operation,
                acquired_at: std::time::Instant::now(),
            })
        }
        Err(_) => {
            info!("[scraper] waiting for active session op={}", operation);
            let wait_started = std::time::Instant::now();
            let guard = session.lock_owned().await;
            capture.background_runtime.begin_job(operation)?;
            info!(
                "[scraper] acquired session op={} wait_ms={}",
                operation,
                wait_started.elapsed().as_millis()
            );
            Ok(ActiveScraperSession {
                _guard: guard,
                background_runtime: capture.background_runtime.clone(),
                operation,
                acquired_at: std::time::Instant::now(),
            })
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

/// Fetch a Google API URL with a bearer token and return its body as text.
#[tauri::command]
async fn google_api_request(url: String, access_token: String) -> Result<String, String> {
    let parsed = url::Url::parse(&url).map_err(|e| format!("Invalid Google API URL: {}", e))?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("people.googleapis.com") {
        return Err("Google API URL is not allowed".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("Freed/1.0 (https://freed.wtf)")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(parsed)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Google API request failed: {}", e))?;

    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("Google API error {}: {}", status.as_u16(), body));
    }

    Ok(body)
}

#[derive(serde::Serialize)]
struct GoogleDriveResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

/// Make a Google Drive API request through the native networking stack.
#[tauri::command]
async fn google_drive_request(
    url: String,
    method: Option<String>,
    headers: Option<Vec<(String, String)>>,
    body: Option<Vec<u8>>,
) -> Result<GoogleDriveResponse, String> {
    let parsed =
        url::Url::parse(&url).map_err(|e| format!("Invalid Google Drive API URL: {}", e))?;
    let allowed_path =
        parsed.path().starts_with("/drive/v3/") || parsed.path().starts_with("/upload/drive/v3/");
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("www.googleapis.com")
        || !allowed_path
    {
        return Err("Google Drive API URL is not allowed".to_string());
    }

    let method_name = method.unwrap_or_else(|| "GET".to_string()).to_uppercase();
    let method = match method_name.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        _ => {
            return Err(format!(
                "Google Drive API method is not allowed: {}",
                method_name
            ))
        }
    };

    let client = reqwest::Client::builder()
        .user_agent("Freed/1.0 (https://freed.wtf)")
        .build()
        .map_err(|e| e.to_string())?;

    let mut builder = client.request(method, parsed);
    for (key, value) in headers.unwrap_or_default() {
        builder = builder.header(&key, &value);
    }
    if let Some(body) = body {
        builder = builder.body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|e| format!("Google Drive request failed: {}", e))?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(key, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (key.as_str().to_string(), value.to_string()))
        })
        .collect();
    let body = response.bytes().await.map_err(|e| e.to_string())?.to_vec();

    Ok(GoogleDriveResponse {
        status,
        headers,
        body,
    })
}

/// Fetch any URL and return its body as bytes for permanent local media archive.
#[tauri::command]
async fn fetch_binary_url(url: String) -> Result<Vec<u8>, String> {
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

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    Ok(bytes.to_vec())
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
async fn sha256_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let model_root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("local-ai-models");
    let root = model_root.canonicalize().map_err(|e| e.to_string())?;
    let target = PathBuf::from(path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !target.starts_with(&root) {
        return Err("Refusing to hash a file outside the local AI model directory".to_string());
    }

    let mut file = tokio::fs::File::open(&target)
        .await
        .map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];

    loop {
        let read = file.read(&mut buffer).await.map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn validate_local_ai_download_url(raw: &str) -> Result<(), String> {
    let url = url::Url::parse(raw).map_err(|error| format!("invalid model file URL: {error}"))?;
    if url.scheme() != "https" || url.host_str() != Some("huggingface.co") {
        return Err("local AI model downloads must use https://huggingface.co".to_string());
    }
    Ok(())
}

fn validate_local_ai_model_path(root: &Path, path: &Path, field: &str) -> Result<(), String> {
    if !path.is_absolute() {
        return Err(format!("{field} must be an absolute path"));
    }
    if !path.starts_with(root) {
        return Err(format!(
            "{field} must stay inside the local AI model directory"
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("{field} is missing a parent directory"))?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
    let canonical_parent = parent.canonicalize().map_err(|error| error.to_string())?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err(format!(
            "{field} must stay inside the local AI model directory"
        ));
    }
    Ok(())
}

fn local_ai_model_download_cancelled(
    state: &tauri::State<'_, LocalAIModelDownloadState>,
    download_id: &str,
) -> bool {
    state
        .0
        .read()
        .map(|cancelled| cancelled.contains(download_id))
        .unwrap_or(false)
}

fn emit_local_ai_download_progress(
    app: &tauri::AppHandle,
    event: &str,
    download_id: &str,
    downloaded_bytes: u64,
) {
    let _ = app.emit(
        event,
        LocalAIModelFileDownloadProgress {
            download_id: download_id.to_string(),
            downloaded_bytes,
        },
    );
}

#[tauri::command]
async fn cancel_local_ai_model_download(
    state: tauri::State<'_, LocalAIModelDownloadState>,
    download_id: String,
) -> Result<(), String> {
    state
        .0
        .write()
        .map_err(|_| "local AI download state is unavailable".to_string())?
        .insert(download_id);
    Ok(())
}

#[tauri::command]
async fn download_local_ai_model_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, LocalAIModelDownloadState>,
    request: LocalAIModelFileDownloadRequest,
) -> Result<u64, String> {
    validate_local_ai_download_url(&request.url)?;

    let model_root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("local-ai-models");
    std::fs::create_dir_all(&model_root).map_err(|error| error.to_string())?;

    let target = PathBuf::from(&request.target_path);
    let partial = PathBuf::from(&request.partial_path);
    validate_local_ai_model_path(&model_root, &target, "targetPath")?;
    validate_local_ai_model_path(&model_root, &partial, "partialPath")?;
    if request.partial_path != format!("{}.partial", request.target_path) {
        return Err("partialPath must match targetPath plus .partial".to_string());
    }

    {
        let mut cancelled = state
            .0
            .write()
            .map_err(|_| "local AI download state is unavailable".to_string())?;
        cancelled.remove(&request.download_id);
    }

    if let Ok(metadata) = tokio::fs::metadata(&target).await {
        if metadata.len() == request.expected_size_bytes {
            emit_local_ai_download_progress(
                &app,
                &request.progress_event,
                &request.download_id,
                request.expected_size_bytes,
            );
            return Ok(request.expected_size_bytes);
        }
        tokio::fs::remove_file(&target)
            .await
            .map_err(|error| error.to_string())?;
    }

    let mut existing_partial_bytes = match tokio::fs::metadata(&partial).await {
        Ok(metadata) => metadata.len(),
        Err(_) => 0,
    };
    if existing_partial_bytes > request.expected_size_bytes {
        tokio::fs::remove_file(&partial)
            .await
            .map_err(|error| error.to_string())?;
        existing_partial_bytes = 0;
    }

    let client = reqwest::Client::new();
    let mut response = {
        let mut builder = client.get(&request.url);
        if existing_partial_bytes > 0 {
            builder = builder.header(
                reqwest::header::RANGE,
                format!("bytes={existing_partial_bytes}-"),
            );
        }
        builder.send().await.map_err(|error| error.to_string())?
    };

    if response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE && existing_partial_bytes > 0
    {
        tokio::fs::remove_file(&partial)
            .await
            .map_err(|error| error.to_string())?;
        existing_partial_bytes = 0;
        response = client
            .get(&request.url)
            .send()
            .await
            .map_err(|error| error.to_string())?;
    }

    let can_append =
        existing_partial_bytes > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    if existing_partial_bytes > 0 && !can_append {
        tokio::fs::remove_file(&partial)
            .await
            .map_err(|error| error.to_string())?;
        existing_partial_bytes = 0;
    }

    if !(response.status().is_success()
        || response.status() == reqwest::StatusCode::PARTIAL_CONTENT)
    {
        return Err(format!(
            "Download failed for local AI model file: {}",
            response.status()
        ));
    }

    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .append(can_append)
        .truncate(!can_append)
        .open(&partial)
        .await
        .map_err(|error| error.to_string())?;

    let mut downloaded_bytes = existing_partial_bytes;
    let mut last_progress_at = Instant::now()
        .checked_sub(LOCAL_AI_DOWNLOAD_PROGRESS_INTERVAL)
        .unwrap_or_else(Instant::now);
    emit_local_ai_download_progress(
        &app,
        &request.progress_event,
        &request.download_id,
        downloaded_bytes,
    );

    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if local_ai_model_download_cancelled(&state, &request.download_id) {
            return Err("download cancelled".to_string());
        }
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        downloaded_bytes = downloaded_bytes.saturating_add(chunk.len() as u64);
        if last_progress_at.elapsed() >= LOCAL_AI_DOWNLOAD_PROGRESS_INTERVAL {
            emit_local_ai_download_progress(
                &app,
                &request.progress_event,
                &request.download_id,
                downloaded_bytes,
            );
            last_progress_at = Instant::now();
        }
    }

    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);

    if local_ai_model_download_cancelled(&state, &request.download_id) {
        return Err("download cancelled".to_string());
    }

    let actual_size = tokio::fs::metadata(&partial)
        .await
        .map_err(|error| error.to_string())?
        .len();
    if actual_size != request.expected_size_bytes {
        return Err(format!(
            "Expected {} bytes for local AI model file, got {}",
            request.expected_size_bytes, actual_size
        ));
    }

    if tokio::fs::metadata(&target).await.is_ok() {
        tokio::fs::remove_file(&target)
            .await
            .map_err(|error| error.to_string())?;
    }
    tokio::fs::rename(&partial, &target)
        .await
        .map_err(|error| error.to_string())?;

    emit_local_ai_download_progress(
        &app,
        &request.progress_event,
        &request.download_id,
        request.expected_size_bytes,
    );

    Ok(request.expected_size_bytes)
}

#[tauri::command]
async fn get_sync_client_count(state: tauri::State<'_, RelayState>) -> Result<usize, String> {
    Ok(*state.client_count.read().await)
}

fn dir_size_bytes(path: &Path) -> Option<u64> {
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.is_file() {
        return Some(metadata.len());
    }
    if !metadata.is_dir() {
        return Some(0);
    }

    let mut total = 0u64;
    let entries = std::fs::read_dir(path).ok()?;
    for entry in entries.flatten() {
        if let Some(size) = dir_size_bytes(&entry.path()) {
            total = total.saturating_add(size);
        }
    }
    Some(total)
}

fn memory_pressure_limits(total_physical_memory_bytes: u64) -> (u64, u64) {
    let proportional = total_physical_memory_bytes.saturating_mul(12) / 100;
    let critical = proportional.clamp(MIN_CRITICAL_MEMORY_BYTES, MAX_CRITICAL_MEMORY_BYTES);
    let high = critical.saturating_mul(70) / 100;
    (high, critical)
}

fn path_is_under_any_root(path: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| path.starts_with(root))
}

fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|existing| existing == &path) {
        paths.push(path);
    }
}

fn app_storage_roots(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(path) = app.path().app_cache_dir() {
        push_unique_path(&mut roots, path);
    }
    if let Ok(path) = app.path().app_data_dir() {
        push_unique_path(&mut roots, path);
    }
    if let Ok(home) = app.path().home_dir() {
        for app_dir in ["wtf.freed.desktop", "freed-desktop"] {
            push_unique_path(
                &mut roots,
                home.join("Library").join("Caches").join(app_dir),
            );
            push_unique_path(
                &mut roots,
                home.join("Library")
                    .join("Application Support")
                    .join(app_dir),
            );
        }
    }
    roots
}

#[cfg(target_os = "macos")]
fn macos_process_has_open_file_under_roots(pid: u32, roots: &[PathBuf]) -> bool {
    let output = Command::new("/usr/sbin/lsof")
        .args(["-n", "-P", "-p", &pid.to_string(), "-Fn"])
        .output();

    let Ok(output) = output else {
        return false;
    };
    if !output.status.success() {
        return false;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.strip_prefix('n'))
        .any(|path| path_is_under_any_root(Path::new(path), roots))
}

fn webkit_process_belongs_to_current_launch(webkit_age_seconds: u64, app_age_seconds: u64) -> bool {
    webkit_age_seconds <= app_age_seconds.saturating_add(WEBKIT_PROCESS_START_GRACE_SECONDS)
}

#[cfg(target_os = "macos")]
fn macos_process_physical_footprint_bytes(pid: u32) -> Option<u64> {
    let mut usage = MaybeUninit::<libc::rusage_info_v4>::uninit();
    let result = unsafe {
        libc::proc_pid_rusage(
            pid as libc::c_int,
            libc::RUSAGE_INFO_V4,
            usage.as_mut_ptr().cast(),
        )
    };
    if result != 0 {
        return None;
    }
    Some(unsafe { usage.assume_init() }.ri_phys_footprint)
}

#[cfg(not(target_os = "macos"))]
fn macos_process_physical_footprint_bytes(_pid: u32) -> Option<u64> {
    None
}

fn freed_webkit_memory_stats(
    system: &System,
    roots: &[PathBuf],
    app_age_seconds: u64,
) -> WebkitMemoryStats {
    let mut total_resident_bytes = 0u64;
    let mut total_footprint_bytes = 0u64;
    let mut has_footprint = false;
    let mut process_count = 0u64;
    let mut largest: Option<WebkitProcessRuntimeStats> = None;
    let mut processes: Vec<WebkitProcessRuntimeStats> = Vec::new();

    #[cfg(target_os = "macos")]
    {
        for (pid, process) in system.processes() {
            let name = process.name().to_string_lossy();
            if !name.contains("WebKit.WebContent") {
                continue;
            }
            let pid_u32 = pid.as_u32();
            if !macos_process_has_open_file_under_roots(pid_u32, roots) {
                continue;
            }
            let age_seconds = process.run_time();
            if !webkit_process_belongs_to_current_launch(age_seconds, app_age_seconds) {
                continue;
            }
            let resident = process.memory();
            let footprint = macos_process_physical_footprint_bytes(pid_u32);
            let virtual_bytes = process.virtual_memory();
            total_resident_bytes = total_resident_bytes.saturating_add(resident);
            if let Some(footprint) = footprint {
                total_footprint_bytes = total_footprint_bytes.saturating_add(footprint);
                has_footprint = true;
            }
            process_count += 1;
            let stats = WebkitProcessRuntimeStats {
                process_id: pid_u32,
                resident_bytes: resident,
                footprint_bytes: footprint,
                virtual_bytes,
                cpu_usage: process.cpu_usage(),
                age_seconds,
                role: "freed-webcontent".to_string(),
            };
            if largest
                .as_ref()
                .map(|best| resident > best.resident_bytes)
                .unwrap_or(true)
            {
                largest = Some(stats.clone());
            }
            processes.push(stats);
        }
    }

    processes.sort_by(|a, b| b.resident_bytes.cmp(&a.resident_bytes));

    WebkitMemoryStats {
        total_resident_bytes,
        total_footprint_bytes: has_footprint.then_some(total_footprint_bytes),
        process_count,
        largest_resident_bytes: largest.as_ref().map(|stats| stats.resident_bytes),
        largest_footprint_bytes: largest.as_ref().and_then(|stats| stats.footprint_bytes),
        largest_virtual_bytes: largest.as_ref().map(|stats| stats.virtual_bytes),
        largest_process_id: largest.as_ref().map(|stats| stats.process_id),
        largest_cpu_usage: largest.as_ref().map(|stats| stats.cpu_usage),
        largest_age_seconds: largest.as_ref().map(|stats| stats.age_seconds),
        largest_role: largest.as_ref().map(|stats| stats.role.clone()),
        processes,
    }
}

fn collect_runtime_memory_stats(
    app: &tauri::AppHandle,
    relay_doc_bytes: u64,
    relay_client_count: u64,
) -> RuntimeMemoryStats {
    let pid = Pid::from_u32(std::process::id());
    let mut system = System::new();
    system.refresh_memory();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing().with_memory(),
    );

    let (process_resident_bytes, process_virtual_bytes, process_age_seconds) = system
        .process(pid)
        .map(|process| {
            (
                process.memory(),
                process.virtual_memory(),
                process.run_time(),
            )
        })
        .unwrap_or((0, 0, 0));
    let process_footprint_bytes = macos_process_physical_footprint_bytes(std::process::id());
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_memory(),
    );

    let webkit = freed_webkit_memory_stats(&system, &app_storage_roots(app), process_age_seconds);
    let total_physical_memory_bytes = system.total_memory();
    let (memory_high_bytes, memory_critical_bytes) =
        memory_pressure_limits(total_physical_memory_bytes);
    let indexed_db_bytes = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|path| dir_size_bytes(&path.join("IndexedDB")));
    let webkit_cache_bytes = app
        .path()
        .app_cache_dir()
        .ok()
        .and_then(|path| dir_size_bytes(&path.join("WebKit")));
    let app_resident_bytes = process_resident_bytes.saturating_add(webkit.total_resident_bytes);
    let webkit_pressure_bytes = webkit
        .total_footprint_bytes
        .unwrap_or(webkit.total_resident_bytes);
    let app_memory_pressure_bytes = process_footprint_bytes
        .unwrap_or(process_resident_bytes)
        .saturating_add(webkit_pressure_bytes);

    RuntimeMemoryStats {
        total_physical_memory_bytes,
        process_resident_bytes,
        process_footprint_bytes,
        process_virtual_bytes,
        app_resident_bytes,
        app_memory_pressure_bytes,
        webkit_resident_bytes: webkit.largest_resident_bytes,
        webkit_footprint_bytes: webkit.largest_footprint_bytes,
        webkit_virtual_bytes: webkit.largest_virtual_bytes,
        webkit_process_id: webkit.largest_process_id,
        webkit_total_resident_bytes: webkit.total_resident_bytes,
        webkit_total_footprint_bytes: webkit.total_footprint_bytes,
        webkit_process_count: webkit.process_count,
        webkit_largest_resident_bytes: webkit.largest_resident_bytes,
        webkit_largest_footprint_bytes: webkit.largest_footprint_bytes,
        webkit_largest_process_id: webkit.largest_process_id,
        webkit_largest_cpu_usage: webkit.largest_cpu_usage,
        webkit_largest_age_seconds: webkit.largest_age_seconds,
        webkit_largest_role: webkit.largest_role,
        webkit_processes: webkit.processes,
        webkit_telemetry_available: webkit.process_count > 0,
        indexed_db_bytes,
        webkit_cache_bytes,
        memory_high_bytes,
        memory_critical_bytes,
        relay_doc_bytes,
        relay_client_count,
    }
}

fn collect_webkit_network_cache_files(root: &Path, files: &mut Vec<(PathBuf, u64, SystemTime)>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            collect_webkit_network_cache_files(&path, files);
            continue;
        }
        if !metadata.is_file() {
            continue;
        }

        files.push((
            path,
            metadata.len(),
            metadata.modified().unwrap_or(UNIX_EPOCH),
        ));
    }
}

fn trim_webkit_network_cache_root_with_result(webkit_root: &Path) -> WebkitCacheTrimResult {
    let webkit_bytes = dir_size_bytes(&webkit_root).unwrap_or(0);
    if webkit_bytes <= WEBKIT_CACHE_TRIM_AT_BYTES {
        return WebkitCacheTrimResult {
            before_bytes: webkit_bytes,
            after_bytes: webkit_bytes,
            cache_trimmed: false,
        };
    }

    let network_cache_root = webkit_root.join("NetworkCache");
    let mut files = Vec::new();
    collect_webkit_network_cache_files(&network_cache_root, &mut files);
    files.sort_by_key(|(_, _, modified)| *modified);

    let mut current_bytes = webkit_bytes;
    let mut trimmed = false;
    for (path, bytes, _) in files {
        if current_bytes <= WEBKIT_CACHE_TRIM_TARGET_BYTES {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            current_bytes = current_bytes.saturating_sub(bytes);
            trimmed = true;
        }
    }

    WebkitCacheTrimResult {
        before_bytes: webkit_bytes,
        after_bytes: current_bytes,
        cache_trimmed: trimmed,
    }
}

fn trim_webkit_network_cache(app: &tauri::AppHandle) -> WebkitCacheTrimResult {
    let Ok(cache_root) = app.path().app_cache_dir() else {
        return WebkitCacheTrimResult {
            before_bytes: 0,
            after_bytes: 0,
            cache_trimmed: false,
        };
    };
    trim_webkit_network_cache_root_with_result(&cache_root.join("WebKit"))
}

fn scrape_memory_start_budget_bytes(stats: &RuntimeMemoryStats) -> u64 {
    stats
        .memory_high_bytes
        .saturating_sub(SCRAPE_MEMORY_HEADROOM_BYTES)
}

fn scrape_memory_may_proceed(stats: &RuntimeMemoryStats) -> bool {
    stats.app_memory_pressure_bytes < scrape_memory_start_budget_bytes(stats)
}

fn optional_story_scrape_may_proceed(stats: &RuntimeMemoryStats) -> bool {
    stats.app_memory_pressure_bytes
        < stats
            .memory_high_bytes
            .saturating_mul(OPTIONAL_STORY_MEMORY_BUDGET_PERCENT)
            / 100
}

fn social_scrape_may_continue(
    app: &tauri::AppHandle,
    provider: &str,
    operation: &str,
    pass_index: usize,
    total_passes: usize,
) -> bool {
    let stats = collect_runtime_memory_stats(app, 0, 0);
    let may_continue = scrape_memory_may_proceed(&stats);
    if !may_continue {
        warn!(
            "[memory] ending scrape early provider={} operation={} pass={}/{} app_pressure={} app_rss={} webkit_pressure={} webkit_rss={} scrape_budget={} high_bytes={} critical_bytes={}",
            provider,
            operation,
            pass_index,
            total_passes,
            stats.app_memory_pressure_bytes,
            stats.app_resident_bytes,
            stats
                .webkit_total_footprint_bytes
                .unwrap_or(stats.webkit_total_resident_bytes),
            stats.webkit_total_resident_bytes,
            scrape_memory_start_budget_bytes(&stats),
            stats.memory_high_bytes,
            stats.memory_critical_bytes
        );
        append_runtime_health(
            app,
            serde_json::json!({
                "event": "social_scrape_stopped_for_memory",
                "provider": provider,
                "operation": operation,
                "passIndex": pass_index,
                "totalPasses": total_passes,
                "appMemoryPressureBytes": stats.app_memory_pressure_bytes,
                "appResidentBytes": stats.app_resident_bytes,
                "webkitFootprintBytes": stats.webkit_total_footprint_bytes,
                "webkitResidentBytes": stats.webkit_total_resident_bytes,
                "webkitLargestProcessId": stats.webkit_largest_process_id,
                "webkitLargestFootprintBytes": stats.webkit_largest_footprint_bytes,
                "webkitLargestResidentBytes": stats.webkit_largest_resident_bytes,
                "scrapeStartBudgetBytes": scrape_memory_start_budget_bytes(&stats),
                "memoryHighBytes": stats.memory_high_bytes,
                "memoryCriticalBytes": stats.memory_critical_bytes
            }),
        );
    }
    may_continue
}

fn optional_story_scrape_may_continue(
    app: &tauri::AppHandle,
    provider: &str,
    operation: &str,
) -> bool {
    let stats = collect_runtime_memory_stats(app, 0, 0);
    let may_continue = optional_story_scrape_may_proceed(&stats);
    if !may_continue {
        info!(
            "[memory] skipping optional story scrape provider={} operation={} app_pressure={} app_rss={} webkit_pressure={} webkit_rss={} story_budget={} high_bytes={}",
            provider,
            operation,
            stats.app_memory_pressure_bytes,
            stats.app_resident_bytes,
            stats
                .webkit_total_footprint_bytes
                .unwrap_or(stats.webkit_total_resident_bytes),
            stats.webkit_total_resident_bytes,
            stats.memory_high_bytes.saturating_mul(OPTIONAL_STORY_MEMORY_BUDGET_PERCENT) / 100,
            stats.memory_high_bytes
        );
        append_runtime_health(
            app,
            serde_json::json!({
                "event": "optional_story_scrape_skipped_for_memory",
                "provider": provider,
                "operation": operation,
                "appMemoryPressureBytes": stats.app_memory_pressure_bytes,
                "appResidentBytes": stats.app_resident_bytes,
                "webkitFootprintBytes": stats.webkit_total_footprint_bytes,
                "webkitResidentBytes": stats.webkit_total_resident_bytes,
                "storyBudgetBytes": stats.memory_high_bytes.saturating_mul(OPTIONAL_STORY_MEMORY_BUDGET_PERCENT) / 100,
                "memoryHighBytes": stats.memory_high_bytes
            }),
        );
    }
    may_continue
}

fn recycle_social_scraper_windows_except(
    app: &tauri::AppHandle,
    preserve_label: Option<&str>,
    reason: &str,
) -> bool {
    let mut recycled = false;
    for label in SOCIAL_SCRAPER_WINDOW_LABELS {
        if preserve_label == Some(label) {
            continue;
        }
        if app.get_webview_window(label).is_some() {
            recycled = true;
        }
        recycle_webview_window(app, label, reason);
    }
    recycled
}

fn blocked_preflight_preserved_scraper_label<'a>(
    preserve_label: Option<&'a str>,
    critical: bool,
) -> Option<&'a str> {
    if critical {
        None
    } else {
        preserve_label
    }
}

async fn prepare_social_scrape_memory_internal(
    app: &tauri::AppHandle,
    provider: &str,
    operation: &str,
    relay_doc_bytes: u64,
    relay_client_count: u64,
    preserve_label: Option<&str>,
) -> ScrapeMemoryPreparation {
    let before = collect_runtime_memory_stats(app, relay_doc_bytes, relay_client_count);
    let reason = format!("{} {} memory preflight", provider, operation);
    let recycled_scraper_windows =
        recycle_social_scraper_windows_except(app, preserve_label, &reason);
    let cache_trim_result = trim_webkit_network_cache(app);
    let cache_trimmed = cache_trim_result.cache_trimmed;

    if recycled_scraper_windows || cache_trimmed {
        tokio::time::sleep(Duration::from_millis(700)).await;
    }

    let after = collect_runtime_memory_stats(app, relay_doc_bytes, relay_client_count);
    let scrape_start_budget_bytes = scrape_memory_start_budget_bytes(&after);
    let may_proceed = scrape_memory_may_proceed(&after);
    let pressure_level = if after.app_memory_pressure_bytes >= after.memory_critical_bytes {
        "critical"
    } else if after.app_memory_pressure_bytes >= after.memory_high_bytes {
        "high"
    } else {
        "normal"
    };
    info!(
        "[memory] scrape preflight provider={} operation={} before_app_pressure={} before_app_rss={} before_webkit_pressure={} before_webkit_rss={} after_app_pressure={} after_app_rss={} after_webkit_pressure={} after_webkit_rss={} scrape_budget={} headroom_bytes={} high_bytes={} critical_bytes={} pressure={} recycled_scrapers={} cache_trimmed={} may_proceed={}",
        provider,
        operation,
        before.app_memory_pressure_bytes,
        before.app_resident_bytes,
        before
            .webkit_total_footprint_bytes
            .unwrap_or(before.webkit_total_resident_bytes),
        before.webkit_total_resident_bytes,
        after.app_memory_pressure_bytes,
        after.app_resident_bytes,
        after
            .webkit_total_footprint_bytes
            .unwrap_or(after.webkit_total_resident_bytes),
        after.webkit_total_resident_bytes,
        scrape_start_budget_bytes,
        SCRAPE_MEMORY_HEADROOM_BYTES,
        after.memory_high_bytes,
        after.memory_critical_bytes,
        pressure_level,
        recycled_scraper_windows,
        cache_trimmed,
        may_proceed
    );
    append_runtime_health(
        app,
        serde_json::json!({
            "event": "scrape_memory_preflight",
            "provider": provider,
            "operation": operation,
            "beforeAppMemoryPressureBytes": before.app_memory_pressure_bytes,
            "beforeAppResidentBytes": before.app_resident_bytes,
            "beforeWebkitFootprintBytes": before.webkit_total_footprint_bytes,
            "beforeWebkitResidentBytes": before.webkit_total_resident_bytes,
            "afterAppMemoryPressureBytes": after.app_memory_pressure_bytes,
            "afterAppResidentBytes": after.app_resident_bytes,
            "afterWebkitFootprintBytes": after.webkit_total_footprint_bytes,
            "afterWebkitResidentBytes": after.webkit_total_resident_bytes,
            "webkitLargestProcessId": after.webkit_largest_process_id,
            "webkitLargestFootprintBytes": after.webkit_largest_footprint_bytes,
            "webkitLargestResidentBytes": after.webkit_largest_resident_bytes,
            "webkitLargestCpuUsage": after.webkit_largest_cpu_usage,
            "webkitLargestAgeSeconds": after.webkit_largest_age_seconds,
            "webkitLargestRole": after.webkit_largest_role,
            "webkitProcessCount": after.webkit_process_count,
            "scrapeStartBudgetBytes": scrape_start_budget_bytes,
            "scrapeHeadroomBytes": SCRAPE_MEMORY_HEADROOM_BYTES,
            "memoryHighBytes": after.memory_high_bytes,
            "memoryCriticalBytes": after.memory_critical_bytes,
            "pressureLevel": pressure_level,
            "recycledScraperWindows": recycled_scraper_windows,
            "cacheTrimmed": cache_trimmed,
            "mayProceed": may_proceed
        }),
    );

    if !may_proceed {
        capture_deep_runtime_diagnostic(
            app,
            "scrape_memory_preflight_blocked",
            &reason,
            &after,
            None,
            None,
            false,
        );
    }

    ScrapeMemoryPreparation {
        before,
        after,
        recycled_scraper_windows,
        cache_trimmed,
        scrape_start_budget_bytes,
        may_proceed,
    }
}

async fn ensure_social_scrape_memory(
    app: &tauri::AppHandle,
    background_runtime: &BackgroundRuntimeCoordinator,
    provider: &str,
    operation: &str,
    preserve_label: Option<&str>,
) -> Result<(), String> {
    let prep =
        prepare_social_scrape_memory_internal(app, provider, operation, 0, 0, preserve_label).await;
    if prep.may_proceed {
        return Ok(());
    }

    let pressure_label = if prep.after.app_memory_pressure_bytes >= prep.after.memory_critical_bytes
    {
        "critically high"
    } else {
        "high"
    };
    let critical = pressure_label == "critically high";
    if critical {
        let reason = format!("{} {} critical memory preflight", provider, operation);
        recycle_social_scraper_windows(app, &reason);
    }
    let mut recycled_preserved_scraper_window = false;
    if let Some(label) = blocked_preflight_preserved_scraper_label(preserve_label, critical) {
        let reason = format!("{} {} blocked memory preflight", provider, operation);
        recycled_preserved_scraper_window = app.get_webview_window(label).is_some();
        recycle_webview_window(app, label, &reason);
    }
    let cooldown_ms = background_runtime.note_memory_pressure(provider, operation, critical);
    warn!(
        "[memory] pausing background scraper work provider={} operation={} pressure={} cooldown_ms={} recycled_preserved_scraper={}",
        provider, operation, pressure_label, cooldown_ms, recycled_preserved_scraper_window
    );
    append_runtime_health(
        app,
        serde_json::json!({
            "event": "background_scraper_memory_cooldown",
            "provider": provider,
            "operation": operation,
            "pressureLevel": if critical { "critical" } else { "high" },
            "cooldownMs": cooldown_ms,
            "appMemoryPressureBytes": prep.after.app_memory_pressure_bytes,
            "appResidentBytes": prep.after.app_resident_bytes,
            "webkitFootprintBytes": prep.after.webkit_total_footprint_bytes,
            "webkitResidentBytes": prep.after.webkit_total_resident_bytes,
            "webkitLargestProcessId": prep.after.webkit_largest_process_id,
            "webkitLargestFootprintBytes": prep.after.webkit_largest_footprint_bytes,
            "webkitLargestResidentBytes": prep.after.webkit_largest_resident_bytes,
            "scrapeStartBudgetBytes": prep.scrape_start_budget_bytes,
            "memoryHighBytes": prep.after.memory_high_bytes,
            "memoryCriticalBytes": prep.after.memory_critical_bytes,
            "recycledAllScraperWindows": critical,
            "recycledPreservedScraperWindow": recycled_preserved_scraper_window,
            "preservedScraperLabel": preserve_label
        }),
    );
    Err(format!(
        "{} sync paused because Freed Desktop memory remains {} after cleanup.",
        provider, pressure_label
    ))
}

#[tauri::command]
async fn get_runtime_memory_stats(
    app: tauri::AppHandle,
    state: tauri::State<'_, RelayState>,
) -> Result<RuntimeMemoryStats, String> {
    let relay_doc_bytes = state
        .current_doc
        .read()
        .await
        .as_ref()
        .map(|doc| doc.len() as u64)
        .unwrap_or(0);
    let relay_client_count = *state.client_count.read().await as u64;

    Ok(collect_runtime_memory_stats(
        &app,
        relay_doc_bytes,
        relay_client_count,
    ))
}

#[tauri::command]
async fn trim_webkit_network_cache_now(
    app: tauri::AppHandle,
) -> Result<WebkitCacheTrimResult, String> {
    let result = trim_webkit_network_cache(&app);
    if result.cache_trimmed {
        info!(
            "[memory] webkit cache trimmed during monitor sample before_bytes={} after_bytes={}",
            result.before_bytes, result.after_bytes
        );
    }
    Ok(result)
}

#[tauri::command]
async fn get_recent_runtime_health(
    app: tauri::AppHandle,
    limit: Option<usize>,
) -> Result<Vec<String>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let path = runtime_health_path(&data_dir);
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let limit = limit.unwrap_or(120).clamp(1, 1_000);
    let lines: Vec<String> = raw.lines().map(|line| line.to_string()).collect();
    let start = lines.len().saturating_sub(limit);
    Ok(lines[start..].to_vec())
}

#[tauri::command]
async fn prepare_social_scrape_memory(
    app: tauri::AppHandle,
    state: tauri::State<'_, RelayState>,
    provider: String,
    operation: String,
) -> Result<ScrapeMemoryPreparation, String> {
    let relay_doc_bytes = state
        .current_doc
        .read()
        .await
        .as_ref()
        .map(|doc| doc.len() as u64)
        .unwrap_or(0);
    let relay_client_count = *state.client_count.read().await as u64;

    Ok(prepare_social_scrape_memory_internal(
        &app,
        &provider,
        &operation,
        relay_doc_bytes,
        relay_client_count,
        None,
    )
    .await)
}

#[tauri::command]
async fn get_ai_hardware_profile(
    app: tauri::AppHandle,
    web_gpu_available: bool,
) -> Result<AIHardwareProfile, String> {
    let mut system = System::new();
    system.refresh_memory();

    let app_data_dir = app.path().app_data_dir().ok();
    let available_app_data_bytes = app_data_dir.as_ref().and_then(|path| {
        let disks = Disks::new_with_refreshed_list();
        disks
            .iter()
            .filter(|disk| path.starts_with(disk.mount_point()))
            .max_by_key(|disk| disk.mount_point().to_string_lossy().len())
            .map(|disk| disk.available_space())
    });

    Ok(AIHardwareProfile {
        total_memory_bytes: Some(system.total_memory()),
        available_memory_bytes: Some(system.available_memory()),
        available_app_data_bytes,
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        web_gpu_available,
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
    let _ = start_main_window(&app);
}

#[tauri::command]
fn retry_startup_after_crash(app: tauri::AppHandle) -> Result<(), String> {
    let _ = start_main_window(&app).map_err(|error| error.to_string())?;
    Ok(())
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
const FB_COMMENTS_EXTRACT_SCRIPT: &str = include_str!("fb-comments-extract.js");

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
    .data_store_identifier(FB_SCRAPER_DATA_STORE_IDENTIFIER)
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
    let _scraper_session = acquire_background_scraper_session(&capture, "fb_check_auth").await?;
    ensure_social_scrape_memory(
        &app,
        &capture.background_runtime,
        "Facebook",
        "auth check",
        Some("fb-scraper"),
    )
    .await?;
    let _recycle_guard = WebviewRecycleGuard::new(app.clone(), "fb-scraper", "auth check");
    let wv = match app.get_webview_window("fb-scraper") {
        Some(w) => w,
        None => WebviewWindowBuilder::new(
            &app,
            "fb-scraper",
            tauri::WebviewUrl::External("https://www.facebook.com/".parse().unwrap()),
        )
        .data_store_identifier(FB_SCRAPER_DATA_STORE_IDENTIFIER)
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
    let _scraper_session = acquire_background_scraper_session(&capture, "fb_scrape_feed").await?;
    ensure_social_scrape_memory(
        &app,
        &capture.background_runtime,
        "Facebook",
        "feed scrape",
        None,
    )
    .await?;
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
            .data_store_identifier(FB_SCRAPER_DATA_STORE_IDENTIFIER)
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
    let skip_stories = !optional_story_scrape_may_continue(&app, "Facebook", "feed scrape") || {
        use rand::Rng;
        rand::thread_rng().gen_bool(0.15)
    };
    let stories_first = !skip_stories && {
        use rand::Rng;
        rand::thread_rng().gen_bool(0.50)
    };
    let story_frame_cap = {
        use rand::Rng;
        rand::thread_rng().gen_range(2usize..=4)
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
        rand::thread_rng().gen_range(6usize..=10)
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
        cleanup_background_scraper_media(&wv);
        if !social_scrape_may_continue(&app, "Facebook", "feed scrape", i + 1, num_passes) {
            break;
        }

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
    cleanup_background_scraper_media(&wv);
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
    let _scraper_session = acquire_background_scraper_session(&capture, "fb_scrape_groups").await?;
    ensure_social_scrape_memory(
        &app,
        &capture.background_runtime,
        "Facebook",
        "groups scrape",
        None,
    )
    .await?;
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
            .data_store_identifier(FB_SCRAPER_DATA_STORE_IDENTIFIER)
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

#[tauri::command]
async fn fb_scrape_comments(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
    url: String,
    window_mode: ScraperWindowMode,
) -> Result<(), String> {
    let scraper_user_agent = stored_or_default_user_agent(&capture.fb_user_agent);
    let _scraper_session =
        acquire_background_scraper_session(&capture, "fb_scrape_comments").await?;
    let _recycle_guard =
        WebviewRecycleGuard::new(app.clone(), "fb-scraper", "comments scrape complete");
    let wv = match app.get_webview_window("fb-scraper") {
        Some(window) => window,
        None => build_hidden_scraper_window(
            &app,
            "fb-scraper",
            "Freed Facebook",
            &url,
            &scraper_user_agent,
        )?,
    };

    prepare_background_scraper_window(&wv, window_mode)?;
    wv.navigate(url.parse().map_err(|e: url::ParseError| e.to_string())?)
        .map_err(|e| e.to_string())?;
    tokio::time::sleep(Duration::from_millis(gaussian_ms(6500.0, 900.0))).await;

    for index in 0..3 {
        wv.eval(FB_COMMENTS_EXTRACT_SCRIPT).map_err(|e| {
            format!(
                "Failed to inject Facebook comments extraction script: {}",
                e
            )
        })?;
        tokio::time::sleep(Duration::from_millis(700)).await;
        if index < 2 {
            let _ = wv.eval(r#"window.scrollBy({ top: 520, behavior: 'smooth' });"#);
            tokio::time::sleep(Duration::from_millis(gaussian_ms(1200.0, 250.0))).await;
        }
    }

    Ok(())
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
const IG_COMMENTS_EXTRACT_SCRIPT: &str = include_str!("ig-comments-extract.js");

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
    .data_store_identifier(IG_SCRAPER_DATA_STORE_IDENTIFIER)
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
                // Post-login auto-scrapes use hidden mode so they do not compete with the main renderer.
                match ig_scrape_feed(scrape_app.clone(), capture, ScraperWindowMode::Hidden).await {
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
    let _scraper_session = acquire_background_scraper_session(&capture, "ig_check_auth").await?;
    ensure_social_scrape_memory(
        &app,
        &capture.background_runtime,
        "Instagram",
        "auth check",
        Some("ig-scraper"),
    )
    .await?;
    let _recycle_guard = WebviewRecycleGuard::new(app.clone(), "ig-scraper", "auth check");
    let wv = match app.get_webview_window("ig-scraper") {
        Some(w) => w,
        None => WebviewWindowBuilder::new(
            &app,
            "ig-scraper",
            tauri::WebviewUrl::External("https://www.instagram.com/".parse().unwrap()),
        )
        .data_store_identifier(IG_SCRAPER_DATA_STORE_IDENTIFIER)
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
    let _scraper_session = acquire_background_scraper_session(&capture, "ig_scrape_feed").await?;
    ensure_social_scrape_memory(
        &app,
        &capture.background_runtime,
        "Instagram",
        "feed scrape",
        None,
    )
    .await?;
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
            .data_store_identifier(IG_SCRAPER_DATA_STORE_IDENTIFIER)
            .user_agent(&scraper_user_agent)
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
    let skip_stories = !optional_story_scrape_may_continue(&app, "Instagram", "feed scrape") || {
        use rand::Rng;
        rand::thread_rng().gen_bool(0.15)
    };
    let stories_first = !skip_stories && {
        use rand::Rng;
        rand::thread_rng().gen_bool(0.50)
    };
    let story_frame_cap = {
        use rand::Rng;
        rand::thread_rng().gen_range(2usize..=4)
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
        rand::thread_rng().gen_range(5usize..=9)
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
        cleanup_background_scraper_media(&wv);
        if !social_scrape_may_continue(&app, "Instagram", "feed scrape", i + 1, num_passes) {
            break;
        }

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
    cleanup_background_scraper_media(&wv);
    info!(
        "[IG] scrape complete, {} extraction passes emitted",
        num_passes + 1
    );

    Ok(())
}

#[tauri::command]
async fn ig_scrape_comments(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
    url: String,
    window_mode: ScraperWindowMode,
) -> Result<(), String> {
    let scraper_user_agent = stored_or_default_user_agent(&capture.ig_user_agent);
    let _scraper_session =
        acquire_background_scraper_session(&capture, "ig_scrape_comments").await?;
    let _recycle_guard =
        WebviewRecycleGuard::new(app.clone(), "ig-scraper", "comments scrape complete");
    let wv = match app.get_webview_window("ig-scraper") {
        Some(window) => window,
        None => build_hidden_scraper_window(
            &app,
            "ig-scraper",
            "Freed Instagram",
            &url,
            &scraper_user_agent,
        )?,
    };

    prepare_background_scraper_window(&wv, window_mode)?;
    wv.navigate(url.parse().map_err(|e: url::ParseError| e.to_string())?)
        .map_err(|e| e.to_string())?;
    tokio::time::sleep(Duration::from_millis(gaussian_ms(6500.0, 900.0))).await;

    for index in 0..3 {
        wv.eval(IG_COMMENTS_EXTRACT_SCRIPT).map_err(|e| {
            format!(
                "Failed to inject Instagram comments extraction script: {}",
                e
            )
        })?;
        tokio::time::sleep(Duration::from_millis(700)).await;
        if index < 2 {
            let _ = wv.eval(r#"window.scrollBy({ top: 520, behavior: 'smooth' });"#);
            tokio::time::sleep(Duration::from_millis(gaussian_ms(1200.0, 250.0))).await;
        }
    }

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
    let _scraper_session = acquire_background_scraper_session(&capture, "fb_visit_url").await?;
    ensure_social_scrape_memory(&app, &capture.background_runtime, "Facebook", "visit", None)
        .await?;
    let _recycle_guard = WebviewRecycleGuard::new(app.clone(), "fb-scraper", "visit complete");
    let wv = match app.get_webview_window("fb-scraper") {
        Some(window) => window,
        None => build_hidden_scraper_window(
            &app,
            "fb-scraper",
            "Freed Facebook",
            &url,
            &scraper_user_agent,
        )?,
    };

    prepare_background_scraper_window(&wv, ScraperWindowMode::Hidden)?;

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
    let _scraper_session = acquire_background_scraper_session(&capture, "ig_visit_url").await?;
    ensure_social_scrape_memory(
        &app,
        &capture.background_runtime,
        "Instagram",
        "visit",
        None,
    )
    .await?;
    let _recycle_guard = WebviewRecycleGuard::new(app.clone(), "ig-scraper", "visit complete");
    let wv = match app.get_webview_window("ig-scraper") {
        Some(window) => window,
        None => build_hidden_scraper_window(
            &app,
            "ig-scraper",
            "Freed Instagram",
            &url,
            &scraper_user_agent,
        )?,
    };

    prepare_background_scraper_window(&wv, ScraperWindowMode::Hidden)?;

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
    let _scraper_session = acquire_background_scraper_session(&capture, "fb_like_post").await?;
    ensure_social_scrape_memory(&app, &capture.background_runtime, "Facebook", "like", None)
        .await?;
    let _recycle_guard = WebviewRecycleGuard::new(app.clone(), "fb-scraper", "like complete");
    let wv = match app.get_webview_window("fb-scraper") {
        Some(window) => window,
        None => build_hidden_scraper_window(
            &app,
            "fb-scraper",
            "Freed Facebook",
            &url,
            &scraper_user_agent,
        )?,
    };

    prepare_background_scraper_window(&wv, ScraperWindowMode::Hidden)?;

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
    let _scraper_session = acquire_background_scraper_session(&capture, "ig_like_post").await?;
    ensure_social_scrape_memory(&app, &capture.background_runtime, "Instagram", "like", None)
        .await?;
    let _recycle_guard = WebviewRecycleGuard::new(app.clone(), "ig-scraper", "like complete");
    let wv = match app.get_webview_window("ig-scraper") {
        Some(window) => window,
        None => build_hidden_scraper_window(
            &app,
            "ig-scraper",
            "Freed Instagram",
            &url,
            &scraper_user_agent,
        )?,
    };

    prepare_background_scraper_window(&wv, ScraperWindowMode::Hidden)?;

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
    .data_store_identifier(LI_SCRAPER_DATA_STORE_IDENTIFIER)
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
    let _scraper_session = acquire_background_scraper_session(&capture, "li_check_auth").await?;
    ensure_social_scrape_memory(
        &app,
        &capture.background_runtime,
        "LinkedIn",
        "auth check",
        Some("li-scraper"),
    )
    .await?;
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
        .data_store_identifier(LI_SCRAPER_DATA_STORE_IDENTIFIER)
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
    let _scraper_session = acquire_background_scraper_session(&capture, "li_scrape_feed").await?;
    ensure_social_scrape_memory(
        &app,
        &capture.background_runtime,
        "LinkedIn",
        "feed scrape",
        None,
    )
    .await?;
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
            .data_store_identifier(LI_SCRAPER_DATA_STORE_IDENTIFIER)
            .user_agent(&scraper_user_agent)
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
        rand::thread_rng().gen_range(4usize..=8)
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
        cleanup_background_scraper_media(&wv);
        if !social_scrape_may_continue(&app, "LinkedIn", "feed scrape", i + 1, num_passes) {
            break;
        }

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

    let _ = wv.eval(
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
    );
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
    let display_name = NSString::from_str("Freed Engine");

    // Label the WebKit content process as "Freed Engine" in Activity Monitor instead
    // of leaving the default custom protocol URL visible.
    unsafe {
        config.setValue_forKey(
            Some(display_name.as_ref()),
            ns_string!("processDisplayName"),
        );
    }

    config
}

#[cfg(target_os = "macos")]
fn disable_window_restoration(window: &tauri::WebviewWindow) {
    let Ok(ns_window) = window.ns_window() else {
        return;
    };

    let ns_window = ns_window.cast::<AnyObject>();
    unsafe {
        let _: () = msg_send![ns_window, setRestorable: false];
        let _: () = msg_send![ns_window, disableSnapshotRestoration];
    }
}

#[cfg(target_os = "macos")]
fn main_window_handle_available(window: &tauri::WebviewWindow) -> bool {
    window.ns_window().is_ok()
}

#[cfg(not(target_os = "macos"))]
fn main_window_handle_available(_window: &tauri::WebviewWindow) -> bool {
    true
}

fn live_main_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    let window = app.get_webview_window(MAIN_WINDOW_LABEL)?;
    if main_window_handle_available(&window) {
        Some(window)
    } else {
        None
    }
}

fn wait_for_main_window_release(app: &tauri::AppHandle, reason: &str) -> Result<(), String> {
    for attempt in 0..MAIN_WINDOW_RELEASE_POLL_ATTEMPTS {
        match app.get_webview_window(MAIN_WINDOW_LABEL) {
            None => return Ok(()),
            Some(window) if !main_window_handle_available(&window) => {
                if attempt == 0 {
                    warn!(
                        "[main-window] waiting for destroyed window label to unregister reason={}",
                        reason
                    );
                }
            }
            Some(_) => {
                if attempt == 0 {
                    warn!(
                        "[main-window] window label still registered after destroy reason={}",
                        reason
                    );
                }
            }
        }

        std::thread::sleep(MAIN_WINDOW_RELEASE_POLL_INTERVAL);
    }

    Err(format!(
        "main window label stayed registered for {} ms after destroy",
        main_window_release_timeout_ms()
    ))
}

fn main_window_release_timeout_ms() -> u128 {
    MAIN_WINDOW_RELEASE_POLL_INTERVAL.as_millis() * MAIN_WINDOW_RELEASE_POLL_ATTEMPTS as u128
}

#[cfg(target_os = "macos")]
fn apply_main_window_vibrancy(window: &tauri::WebviewWindow, context: &str) -> bool {
    match apply_vibrancy(
        window,
        NSVisualEffectMaterial::UnderWindowBackground,
        None,
        None,
    ) {
        Ok(()) => true,
        Err(error) => {
            warn!(
                "[main-window] vibrancy unavailable context={} error={}",
                context, error
            );
            false
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn apply_main_window_vibrancy(_window: &tauri::WebviewWindow, _context: &str) -> bool {
    false
}

fn show_webview_window(window: &tauri::WebviewWindow) {
    show_app_for_main_window(window, "show");
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    force_show_webview_window(window, "show");
}

#[cfg(target_os = "macos")]
fn show_app_for_main_window(window: &tauri::WebviewWindow, context: &str) {
    let app = window.app_handle();
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    let _ = app.show();
    force_activate_ns_app(context);
}

#[cfg(not(target_os = "macos"))]
fn show_app_for_main_window(_window: &tauri::WebviewWindow, _context: &str) {}

#[cfg(target_os = "macos")]
fn force_activate_ns_app(context: &str) {
    let Some(mtm) = MainThreadMarker::new() else {
        warn!(
            "[main-window] forced app activation skipped off main thread context={}",
            context
        );
        return;
    };

    let ns_app = NSApplication::sharedApplication(mtm);
    let policy_before = ns_app.activationPolicy();
    let policy_changed = ns_app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
    let policy_after = ns_app.activationPolicy();
    ns_app.unhide(None);
    ns_app.activate();

    let running_app = NSRunningApplication::currentApplication();
    let running_unhidden = running_app.unhide();
    #[allow(deprecated)]
    let running_activation_requested = running_app.activateWithOptions(
        NSApplicationActivationOptions::ActivateAllWindows
            | NSApplicationActivationOptions::ActivateIgnoringOtherApps,
    );

    info!(
        "[main-window] forced app activation context={} policy_before={} policy_after={} policy_changed={} running_unhidden={} running_activation_requested={}",
        context,
        policy_before.0,
        policy_after.0,
        policy_changed,
        running_unhidden,
        running_activation_requested
    );
}

#[cfg(not(target_os = "macos"))]
fn force_activate_ns_app(_context: &str) {}

#[cfg(target_os = "macos")]
fn force_show_webview_window(window: &tauri::WebviewWindow, context: &str) {
    let Ok(ns_window) = window.ns_window() else {
        warn!(
            "[main-window] NSWindow unavailable during forced show context={}",
            context
        );
        return;
    };

    let was_visible = window.is_visible().ok();
    let was_focused = window.is_focused().ok();
    let ns_window = ns_window.cast::<AnyObject>();
    unsafe {
        let nil: *mut AnyObject = std::ptr::null_mut();
        let _: () = msg_send![ns_window, setIsVisible: true];
        let _: () = msg_send![ns_window, setReleasedWhenClosed: false];
        let _: () = msg_send![ns_window, deminiaturize: nil];
        let _: () = msg_send![ns_window, makeKeyAndOrderFront: nil];
        let _: () = msg_send![ns_window, orderFrontRegardless];
    }
    info!(
        "[main-window] forced native window show context={} was_visible={:?} was_focused={:?} now_visible={:?} now_focused={:?}",
        context,
        was_visible,
        was_focused,
        window.is_visible().ok(),
        window.is_focused().ok()
    );
}

#[cfg(not(target_os = "macos"))]
fn force_show_webview_window(_window: &tauri::WebviewWindow, _context: &str) {}

fn schedule_main_window_visibility_probe(
    app: &tauri::AppHandle,
    delay: Duration,
    context: &'static str,
) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        let app_for_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            let Some(window) = live_main_window(&app_for_main) else {
                warn!(
                    "[main-window] visibility probe found no live main window context={}",
                    context
                );
                return;
            };

            let before_visible = window.is_visible().ok();
            let before_focused = window.is_focused().ok();
            show_app_for_main_window(&window, context);
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            force_show_webview_window(&window, context);
            info!(
                "[main-window] visibility probe context={} before_visible={:?} before_focused={:?} after_visible={:?} after_focused={:?}",
                context,
                before_visible,
                before_focused,
                window.is_visible().ok(),
                window.is_focused().ok()
            );
        });
    });
}

fn create_main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, tauri::Error> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if main_window_handle_available(&window) {
            return Ok(window);
        }

        warn!("[main-window] ignoring registered window with unavailable native handle");
    }

    let window_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == MAIN_WINDOW_LABEL)
        .expect("missing main window config")
        .clone();

    let builder = tauri::WebviewWindowBuilder::from_config(app, &window_config)?;
    let builder = match std::env::var("FREED_TAURI_WINDOW_TITLE") {
        Ok(title) if !title.trim().is_empty() => builder.title(title),
        _ => builder,
    };

    #[cfg(target_os = "macos")]
    let builder = builder.with_webview_configuration(main_window_webview_configuration());

    let window = builder.build()?;

    #[cfg(target_os = "macos")]
    disable_window_restoration(&window);

    Ok(window)
}

fn open_main_window_recovery_keepalive(
    app: &tauri::AppHandle,
    reason: &str,
) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_RECOVERY_KEEPALIVE_LABEL) {
        info!(
            "[main-window] reusing renderer recovery keepalive reason={}",
            reason
        );
        return Ok(window);
    }

    let window = tauri::WebviewWindowBuilder::new(
        app,
        MAIN_WINDOW_RECOVERY_KEEPALIVE_LABEL,
        tauri::WebviewUrl::App(RECOVERY_WINDOW_ROUTE.into()),
    )
    .title("Freed")
    .inner_size(1.0, 1.0)
    .resizable(false)
    .decorations(false)
    .focused(false)
    .visible(false)
    .skip_taskbar(true)
    .build()
    .map_err(|error| format!("recovery keepalive build failed: {}", error))?;

    info!(
        "[main-window] opened renderer recovery keepalive reason={}",
        reason
    );
    Ok(window)
}

fn close_main_window_recovery_keepalive(app: &tauri::AppHandle, reason: &str) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_RECOVERY_KEEPALIVE_LABEL) else {
        return;
    };

    match window.destroy() {
        Ok(()) => info!(
            "[main-window] closed renderer recovery keepalive reason={}",
            reason
        ),
        Err(error) => warn!(
            "[main-window] failed to close renderer recovery keepalive reason={} error={}",
            reason, error
        ),
    }
}

fn start_main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, tauri::Error> {
    if let Some(window) = live_main_window(app) {
        show_webview_window(&window);
        return Ok(window);
    }

    if let Ok(data_dir) = app.path().app_data_dir() {
        std::fs::create_dir_all(&data_dir).ok();
        mark_startup_pending(&data_dir);
    }

    let window = create_main_window(app)?;
    show_webview_window(&window);
    schedule_main_window_visibility_probe(app, Duration::from_millis(250), "startup-250ms");
    schedule_main_window_visibility_probe(app, Duration::from_secs(1), "startup-1s");
    schedule_main_window_visibility_probe(app, Duration::from_secs(3), "startup-3s");
    let vibrancy_applied = apply_main_window_vibrancy(&window, "startup");
    info!(
        "[main-window] startup window ready vibrancy_applied={}",
        vibrancy_applied
    );
    Ok(window)
}

fn run_main_window_step_on_main_thread<F, T>(
    app: &tauri::AppHandle,
    context: &'static str,
    step: F,
) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel();

    app.run_on_main_thread(move || {
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(step))
            .unwrap_or_else(|_| Err(format!("{context} panicked on main thread")));
        let _ = tx.send(outcome);
    })
    .map_err(|error| format!("failed to schedule {context} on main thread: {error}"))?;

    match rx.recv_timeout(MAIN_THREAD_WINDOW_STEP_TIMEOUT) {
        Ok(outcome) => outcome,
        Err(error) => Err(format!("timed out waiting for {context}: {error}")),
    }
}

fn request_restart_after_recovery_failure(app: &tauri::AppHandle, reason: &str, error: &str) {
    if let Ok(data_dir) = app.path().app_data_dir() {
        mark_startup_failed(&data_dir);
    }
    append_runtime_health(
        app,
        serde_json::json!({
            "event": "renderer_recovery_restart_requested",
            "reason": reason,
            "error": error
        }),
    );
    app.request_restart();

    let app_for_exit = app.clone();
    let reason_for_exit = reason.to_string();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FORCE_EXIT_AFTER_RESTART_REQUEST).await;
        warn!(
            "[main-window] forcing old process exit after restart request reason={}",
            reason_for_exit
        );
        app_for_exit.exit(0);
    });
}

fn recover_main_window(app: &tauri::AppHandle, reason: &str) -> Result<(), String> {
    let app_for_destroy = app.clone();
    let reason_for_destroy = reason.to_string();
    let outcome =
        run_main_window_step_on_main_thread(app, "renderer recovery destroy", move || {
            open_main_window_recovery_keepalive(&app_for_destroy, &reason_for_destroy)?;
            destroy_main_window_for_recovery(&app_for_destroy, &reason_for_destroy)
        })
        .and_then(|was_visible| {
            wait_for_main_window_release(app, reason)?;

            let app_for_create = app.clone();
            let reason_for_create = reason.to_string();
            run_main_window_step_on_main_thread(app, "renderer recovery rebuild", move || {
                rebuild_main_window_after_recovery(&app_for_create, &reason_for_create, was_visible)
            })
        });

    if outcome.is_ok() {
        close_main_window_recovery_keepalive(app, reason);
    } else if let Err(error) = &outcome {
        error!(
            "[main-window] renderer recovery failed; requesting app restart reason={} error={}",
            reason, error
        );
        request_restart_after_recovery_failure(app, reason, error);
        close_main_window_recovery_keepalive(app, reason);
    }

    outcome
}

fn destroy_main_window_for_recovery(app: &tauri::AppHandle, reason: &str) -> Result<bool, String> {
    let was_visible = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        scrub_webview_before_destroy(&window);
        window
            .destroy()
            .map_err(|error| format!("destroy failed: {}", error))?;
        info!("[main-window] destroyed stale renderer ({})", reason);
    }

    Ok(was_visible)
}

fn rebuild_main_window_after_recovery(
    app: &tauri::AppHandle,
    reason: &str,
    was_visible: bool,
) -> Result<(), String> {
    let window = create_main_window(app).map_err(|error| error.to_string())?;

    if was_visible {
        show_webview_window(&window);
    } else {
        let _ = window.hide();
    }

    let vibrancy_applied = apply_main_window_vibrancy(&window, "renderer-recovery");
    info!(
        "[main-window] rebuilt renderer after heartbeat stall reason={} restored_visible={} vibrancy_applied={}",
        reason, was_visible, vibrancy_applied
    );
    Ok(())
}

fn show_primary_window(app: &tauri::AppHandle) {
    if let Some(window) = live_main_window(app) {
        show_webview_window(&window);
        return;
    }

    if let Some(window) = app.get_webview_window(RECOVERY_WINDOW_LABEL) {
        show_webview_window(&window);
        return;
    }

    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };

    if startup_requires_recovery(&load_startup_recovery_state(&data_dir)) {
        if let Ok(window) = open_or_focus_recovery_window(app) {
            show_webview_window(&window);
        }
    } else {
        let _ = start_main_window(app);
    }
}

fn handle_primary_menu_action(app: &tauri::AppHandle, id: &str) -> bool {
    match id {
        PRIMARY_MENU_ITEM_SHOW => {
            show_primary_window(app);
            true
        }
        PRIMARY_MENU_ITEM_QUIT => {
            app.exit(0);
            true
        }
        _ => false,
    }
}

fn build_primary_action_items<R: tauri::Runtime, M: Manager<R>>(
    manager: &M,
) -> tauri::Result<(MenuItem<R>, MenuItem<R>)> {
    Ok((
        MenuItem::with_id(
            manager,
            PRIMARY_MENU_ITEM_SHOW,
            "Show Freed",
            true,
            None::<&str>,
        )?,
        MenuItem::with_id(
            manager,
            PRIMARY_MENU_ITEM_QUIT,
            "Quit Freed",
            true,
            None::<&str>,
        )?,
    ))
}

#[cfg(target_os = "macos")]
fn build_macos_app_menu<R: tauri::Runtime, M: Manager<R>>(manager: &M) -> tauri::Result<Menu<R>> {
    let (show_item, quit_item) = build_primary_action_items(manager)?;
    let app_menu = Submenu::with_items(
        manager,
        manager.app_handle().package_info().name.clone(),
        true,
        &[&show_item, &quit_item],
    )?;

    Menu::with_items(manager, &[&app_menu])
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

    let builder = tauri::Builder::default()
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
        .manage(LocalAIModelDownloadState::default())
        .manage(CaptureState::new());

    #[cfg(target_os = "macos")]
    let builder = builder
        .enable_macos_default_menu(false)
        .menu(build_macos_app_menu);

    let builder = builder.on_menu_event(|app, event| {
        let _ = handle_primary_menu_action(app, event.id().as_ref());
    });

    builder.setup(move |app| {
            let app_handle = app.handle().clone();

            let data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");
            std::fs::create_dir_all(&data_dir).ok();

            #[cfg(target_os = "macos")]
            clear_saved_window_state(&app_handle);

            let startup_recovery_state = reconcile_startup_recovery_state(&data_dir);
            if startup_requires_recovery(&startup_recovery_state) {
                warn!(
                    "[recovery] opening native recovery window after {} failed early startup attempt(s)",
                    startup_recovery_state.consecutive_failed_boots
                );
                let _ = open_or_focus_recovery_window(&app_handle)?;
            } else {
                let _ = start_main_window(&app_handle)?;
            }

            // Load (or generate) the persistent pairing token before the relay
            // starts accepting connections.
            let token = load_or_create_token(&data_dir);
            *relay_state_clone.pairing_token.write().unwrap() = token;

            // Build system tray
            let (show_item, quit_item) = build_primary_action_items(app)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .menu(&menu)
                .tooltip("Freed — Sync running")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    id => {
                        let _ = handle_primary_menu_action(&app.app_handle(), id);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        show_primary_window(&app);
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
            let app_for_renderer_listener = app_for_renderer.clone();
            let background_runtime_for_listener = app
                .state::<CaptureState>()
                .background_runtime
                .clone();
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
                let (first_heartbeat, gap_ms, recovered) =
                    health.note_heartbeat(&payload, now);
                background_runtime_for_listener.note_renderer_heartbeat();

                let href = truncate_for_log(&payload.href, 120);
                let (active_job, active_job_age_ms) =
                    background_runtime_for_listener.active_job_for_health();
                append_runtime_health(
                    &app_for_renderer_listener,
                    serde_json::json!({
                        "event": "renderer_heartbeat",
                        "rendererGeneration": health.renderer_generation,
                        "seq": payload.seq,
                        "reason": payload.reason.clone(),
                        "visibility": payload.visibility.clone(),
                        "href": href.clone(),
                        "pageLoadId": payload.page_load_id.clone(),
                        "uptimeMs": payload.uptime_ms,
                        "appPhase": payload.app_phase.clone(),
                        "eventLoopLagMs": payload.event_loop_lag_ms,
                        "domNodeCount": payload.dom_node_count,
                        "rendererHeapUsedBytes": payload.renderer_heap_used_bytes,
                        "rendererHeapTotalBytes": payload.renderer_heap_total_bytes,
                        "lastInputAgeMs": payload.last_input_age_ms,
                        "settingsOpen": payload.settings_open,
                        "dialogOpen": payload.dialog_open,
                        "gapMs": gap_ms,
                        "recovered": recovered,
                        "activeBackgroundJob": active_job,
                        "activeBackgroundJobAgeMs": active_job_age_ms
                    }),
                );
                if recovered {
                    let _ = app_for_renderer_listener.emit(
                        "renderer-recovery-state",
                        serde_json::json!({
                            "phase": "recovered",
                            "reason": payload.reason.clone(),
                            "rendererGeneration": health.renderer_generation,
                            "seq": payload.seq,
                            "gapMs": gap_ms
                        }),
                    );
                }
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

                if first_heartbeat {
                    if let Ok(data_dir) = app_for_renderer_listener.path().app_data_dir() {
                        mark_startup_success(&data_dir);
                    }
                    if let Some(window) =
                        app_for_renderer_listener.get_webview_window(RECOVERY_WINDOW_LABEL)
                    {
                        let _ = window.close();
                    }
                }
            });

            let renderer_health_for_watchdog = renderer_health.clone();
            let app_for_renderer_watchdog = app.handle().clone();
            let background_runtime_for_watchdog = app
                .state::<CaptureState>()
                .background_runtime
                .clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(RENDERER_HEARTBEAT_WATCHDOG_INTERVAL).await;

                    let is_main_visible = app_for_renderer_watchdog
                        .get_webview_window(MAIN_WINDOW_LABEL)
                        .and_then(|window| window.is_visible().ok())
                        .unwrap_or(false);

                    let (should_recycle_scrapers, should_recover_main) = {
                        let mut health = renderer_health_for_watchdog.write().unwrap();
                        let age = health
                            .last_seen_at
                            .map(|last| last.elapsed())
                            .unwrap_or_else(|| health.started_at.elapsed());

                        let recent_recovery_count =
                            health.recent_recovery_count(BACKGROUND_SAFE_MODE_RECOVERY_WINDOW_SHORT);
                        let recovery_threshold = renderer_recovery_threshold_for_count(
                            is_main_visible,
                            &health.last_visibility,
                            recent_recovery_count,
                        );
                        let stale_log_after =
                            renderer_stale_log_after(is_main_visible, &health.last_visibility);
                        let should_log_stale =
                            age > stale_log_after && !health.stale_logged;
                        let recovery_allowed = renderer_stale_should_recover(
                            is_main_visible,
                            &health.last_visibility,
                        );
                        let should_recover =
                            recovery_allowed &&
                            age > recovery_threshold &&
                            health
                                .last_recovery_at
                                .map(|last| last.elapsed() > recovery_threshold)
                                .unwrap_or(true);
                        let mut should_recycle_background_scrapers = false;

                        if should_log_stale {
                            let stats = collect_runtime_memory_stats(&app_for_renderer_watchdog, 0, 0);
                            let webkit = stats
                                .webkit_largest_process_id
                                .zip(stats.webkit_largest_resident_bytes)
                                .zip(stats.webkit_virtual_bytes)
                                .map(|((pid, resident), virtual_bytes)| (pid, resident, virtual_bytes));
                            let webkit_details = webkit
                                .map(|(pid, resident, virtual_bytes)| {
                                    format!(
                                        "webkit_pid={} webkit_rss={} webkit_virtual={}",
                                        pid,
                                        format_bytes_for_log(resident),
                                        format_bytes_for_log(virtual_bytes)
                                    )
                                })
                                .unwrap_or_else(|| "webkit_rss=unavailable".to_string());
                            warn!(
                                "[main-window] renderer heartbeat stale age_ms={} threshold_ms={} visible={} recovery_allowed={} last_seq={} last_reason={} last_visibility={} href={} native_rss={} {}",
                                age.as_millis(),
                                recovery_threshold.as_millis(),
                                is_main_visible,
                                recovery_allowed,
                                health.last_seq,
                                health.last_reason,
                                health.last_visibility,
                                truncate_for_log(&health.last_href, 120),
                                format_bytes_for_log(stats.process_resident_bytes),
                                webkit_details
                            );
                            health.stale_logged = true;
                            let pause_background_work =
                                renderer_stale_log_should_pause_background(
                                    is_main_visible,
                                    &health.last_visibility,
                                );
                            let capture_deep_diagnostic =
                                renderer_stale_log_should_capture_deep_diagnostic(
                                    is_main_visible,
                                    &health.last_visibility,
                                );
                            if pause_background_work {
                                background_runtime_for_watchdog
                                    .note_renderer_stale("renderer heartbeat stale");
                                should_recycle_background_scrapers = true;
                            }
                            let (active_job, active_job_age_ms) =
                                background_runtime_for_watchdog.active_job_for_health();
                            let (safe_mode_active, safe_mode_remaining_ms, recoveries_short, recoveries_long) =
                                background_runtime_for_watchdog.recovery_status_for_health();
                            append_runtime_health(
                                &app_for_renderer_watchdog,
                                serde_json::json!({
                                    "event": "renderer_heartbeat_stale",
                                    "rendererGeneration": health.renderer_generation,
                                    "ageMs": age.as_millis(),
                                    "thresholdMs": recovery_threshold.as_millis(),
                                    "visible": is_main_visible,
                                    "lastSeq": health.last_seq,
                                    "lastReason": health.last_reason.clone(),
                                    "lastVisibility": health.last_visibility.clone(),
                                    "href": truncate_for_log(&health.last_href, 120),
                                    "pageLoadId": health.last_page_load_id.clone(),
                                    "uptimeMs": health.last_uptime_ms,
                                    "appPhase": health.last_app_phase.clone(),
                                    "eventLoopLagMs": health.last_event_loop_lag_ms,
                                    "domNodeCount": health.last_dom_node_count,
                                    "rendererHeapUsedBytes": health.last_renderer_heap_used_bytes,
                                    "rendererHeapTotalBytes": health.last_renderer_heap_total_bytes,
                                    "lastInputAgeMs": health.last_input_age_ms,
                                    "settingsOpen": health.last_settings_open,
                                    "dialogOpen": health.last_dialog_open,
                                    "rendererRecoveryAllowed": recovery_allowed,
                                    "backgroundWorkPaused": pause_background_work,
                                    "deepDiagnosticCaptured": capture_deep_diagnostic,
                                    "nativeResidentBytes": stats.process_resident_bytes,
                                    "webkitResidentBytes": stats.webkit_total_resident_bytes,
                                    "webkitLargestProcessId": stats.webkit_largest_process_id,
                                    "webkitLargestResidentBytes": stats.webkit_largest_resident_bytes,
                                    "webkitLargestCpuUsage": stats.webkit_largest_cpu_usage,
                                    "webkitLargestAgeSeconds": stats.webkit_largest_age_seconds,
                                    "webkitLargestRole": stats.webkit_largest_role,
                                    "webkitProcessCount": stats.webkit_process_count,
                                    "memoryHighBytes": stats.memory_high_bytes,
                                    "memoryCriticalBytes": stats.memory_critical_bytes,
                                    "safeModeActive": safe_mode_active,
                                    "safeModeRemainingMs": safe_mode_remaining_ms,
                                    "recoveriesInShortWindow": recoveries_short,
                                    "recoveriesInLongWindow": recoveries_long,
                                    "activeBackgroundJob": active_job,
                                    "activeBackgroundJobAgeMs": active_job_age_ms
                                }),
                            );
                            let _ = app_for_renderer_watchdog.emit(
                                "renderer-recovery-state",
                                serde_json::json!({
                                    "phase": "stale",
                                    "reason": "renderer heartbeat stale",
                                    "rendererGeneration": health.renderer_generation,
                                    "ageMs": age.as_millis(),
                                    "thresholdMs": recovery_threshold.as_millis(),
                                    "rendererRecoveryAllowed": recovery_allowed,
                                    "safeModeActive": safe_mode_active,
                                    "safeModeRemainingMs": safe_mode_remaining_ms,
                                    "recoveriesInShortWindow": recoveries_short,
                                    "recoveriesInLongWindow": recoveries_long
                                }),
                            );
                            if capture_deep_diagnostic {
                                capture_deep_runtime_diagnostic(
                                    &app_for_renderer_watchdog,
                                    "renderer_heartbeat_stale",
                                    "renderer heartbeat stale",
                                    &stats,
                                    active_job,
                                    active_job_age_ms,
                                    false,
                                );
                            }
                        }

                        if should_recover {
                            let attempt = health.note_recovery_attempt(std::time::Instant::now());
                            background_runtime_for_watchdog
                                .note_renderer_recovery_attempt("renderer heartbeat stale");
                            let stats = collect_runtime_memory_stats(&app_for_renderer_watchdog, 0, 0);
                            let (active_job, active_job_age_ms) =
                                background_runtime_for_watchdog.active_job_for_health();
                            let (safe_mode_active, safe_mode_remaining_ms, recoveries_short, recoveries_long) =
                                background_runtime_for_watchdog.recovery_status_for_health();
                            append_runtime_health(
                                &app_for_renderer_watchdog,
                                serde_json::json!({
                                    "event": "renderer_recovery_attempt",
                                    "rendererGeneration": health.renderer_generation,
                                    "attempt": attempt,
                                    "ageMs": age.as_millis(),
                                    "thresholdMs": recovery_threshold.as_millis(),
                                    "visible": is_main_visible,
                                    "lastVisibility": health.last_visibility.clone(),
                                    "rendererRecoveryAllowed": recovery_allowed,
                                    "webkitResidentBytes": stats.webkit_total_resident_bytes,
                                    "webkitLargestProcessId": stats.webkit_largest_process_id,
                                    "webkitLargestResidentBytes": stats.webkit_largest_resident_bytes,
                                    "webkitLargestCpuUsage": stats.webkit_largest_cpu_usage,
                                    "webkitLargestAgeSeconds": stats.webkit_largest_age_seconds,
                                    "webkitLargestRole": stats.webkit_largest_role,
                                    "webkitProcessCount": stats.webkit_process_count,
                                    "memoryHighBytes": stats.memory_high_bytes,
                                    "memoryCriticalBytes": stats.memory_critical_bytes,
                                    "safeModeActive": safe_mode_active,
                                    "safeModeRemainingMs": safe_mode_remaining_ms,
                                    "recoveriesInShortWindow": recoveries_short,
                                    "recoveriesInLongWindow": recoveries_long,
                                    "activeBackgroundJob": active_job,
                                    "activeBackgroundJobAgeMs": active_job_age_ms
                                }),
                            );
                            let _ = app_for_renderer_watchdog.emit(
                                "renderer-recovery-state",
                                serde_json::json!({
                                    "phase": if safe_mode_active { "safe_mode" } else { "recovery_attempt" },
                                    "reason": "renderer heartbeat stale",
                                    "rendererGeneration": health.renderer_generation,
                                    "attempt": attempt,
                                    "ageMs": age.as_millis(),
                                    "thresholdMs": recovery_threshold.as_millis(),
                                    "lastVisibility": health.last_visibility.clone(),
                                    "rendererRecoveryAllowed": recovery_allowed,
                                    "safeModeActive": safe_mode_active,
                                    "safeModeRemainingMs": safe_mode_remaining_ms,
                                    "recoveriesInShortWindow": recoveries_short,
                                    "recoveriesInLongWindow": recoveries_long
                                }),
                            );
                            capture_deep_runtime_diagnostic(
                                &app_for_renderer_watchdog,
                                "renderer_recovery_attempt",
                                "renderer heartbeat stale",
                                &stats,
                                active_job,
                                active_job_age_ms,
                                true,
                            );
                            warn!(
                                "[main-window] recovering stale renderer attempt={} age_ms={} threshold_ms={} visible={} safe_mode={}",
                                attempt,
                                age.as_millis(),
                                recovery_threshold.as_millis(),
                                is_main_visible,
                                safe_mode_active
                            );
                        }

                        (should_recycle_background_scrapers || should_recover, should_recover)
                    };

                    if should_recycle_scrapers {
                        recycle_social_scraper_windows(
                            &app_for_renderer_watchdog,
                            "main renderer heartbeat stale",
                        );
                    }

                    if should_recover_main {
                        if let Err(error) = recover_main_window(
                            &app_for_renderer_watchdog,
                            "renderer heartbeat stale",
                        ) {
                            error!(
                                "[main-window] failed to recover stale renderer: {}",
                                error
                            );
                        } else {
                            let _ = app_for_renderer_watchdog.emit(
                                "renderer-recovery-state",
                                serde_json::json!({
                                    "phase": "rebuilt",
                                    "reason": "renderer heartbeat stale"
                                }),
                            );
                            recycle_social_scraper_windows(
                                &app_for_renderer_watchdog,
                                "main renderer recovered",
                            );
                        }
                    }
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
                if window.label() == MAIN_WINDOW_LABEL {
                    window.hide().unwrap();
                    api.prevent_close();
                } else if window.label() == RECOVERY_WINDOW_LABEL
                    && window
                        .app_handle()
                        .get_webview_window(MAIN_WINDOW_LABEL)
                        .is_none()
                {
                    window.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_version,
            get_platform,
            get_updater_target,
            retry_startup_after_crash,
            fetch_url,
            google_api_request,
            google_drive_request,
            fetch_binary_url,
            x_api_request,
            get_local_ip,
            get_all_local_ips,
            get_sync_url,
            sha256_file,
            download_local_ai_model_file,
            cancel_local_ai_model_download,
            get_sync_client_count,
            get_runtime_memory_stats,
            trim_webkit_network_cache_now,
            get_recent_runtime_health,
            get_ai_hardware_profile,
            prepare_social_scrape_memory,
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
            fb_scrape_comments,
            fb_disconnect,
            ig_show_login,
            ig_hide_login,
            ig_check_auth,
            ig_scrape_feed,
            ig_scrape_comments,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_pressure_limits_are_adaptive() {
        assert_eq!(
            memory_pressure_limits(16 * BYTES_PER_GIB),
            (
                MIN_CRITICAL_MEMORY_BYTES * 70 / 100,
                MIN_CRITICAL_MEMORY_BYTES
            )
        );
        assert_eq!(
            memory_pressure_limits(32 * BYTES_PER_GIB),
            (
                (32 * BYTES_PER_GIB * 12 / 100) * 70 / 100,
                32 * BYTES_PER_GIB * 12 / 100,
            )
        );
        assert_eq!(
            memory_pressure_limits(128 * BYTES_PER_GIB),
            (
                MAX_CRITICAL_MEMORY_BYTES * 70 / 100,
                MAX_CRITICAL_MEMORY_BYTES
            )
        );
    }

    #[test]
    fn background_runtime_requires_stable_renderer_before_jobs() {
        let runtime = BackgroundRuntimeCoordinator::new();
        assert!(runtime.begin_job("fb_scrape_feed").is_err());

        runtime.note_renderer_heartbeat();
        assert!(runtime.begin_job("fb_scrape_feed").is_err());

        runtime.note_renderer_heartbeat();
        assert!(runtime.begin_job("fb_scrape_feed").is_ok());
        assert!(runtime.begin_job("ig_scrape_feed").is_err());
        assert!(runtime.finish_job("fb_scrape_feed").is_some());
    }

    #[test]
    fn background_runtime_blocks_during_recovery_cooldown() {
        let runtime = BackgroundRuntimeCoordinator::new();
        runtime.note_renderer_heartbeat();
        runtime.note_renderer_heartbeat();
        assert!(runtime.begin_job("fb_scrape_feed").is_ok());
        let _ = runtime.finish_job("fb_scrape_feed");

        runtime.note_renderer_stale("test stale renderer");
        let err = runtime.begin_job("ig_scrape_feed").unwrap_err();
        assert!(err.contains("renderer is stale") || err.contains("cooling down"));

        runtime.note_renderer_heartbeat();
        runtime.note_renderer_heartbeat();
        let err = runtime.begin_job("ig_scrape_feed").unwrap_err();
        assert!(err.contains("cooling down"));
    }

    #[test]
    fn background_runtime_blocks_after_memory_pressure() {
        let runtime = BackgroundRuntimeCoordinator::new();
        runtime.note_renderer_heartbeat();
        runtime.note_renderer_heartbeat();
        assert!(runtime.begin_job("fb_scrape_feed").is_ok());
        assert!(runtime.finish_job("fb_scrape_feed").is_some());

        let high_cooldown = runtime.note_memory_pressure("Facebook", "visit", false);
        assert!(high_cooldown > 0);
        let high_err = runtime.begin_job("ig_visit_url").unwrap_err();
        assert!(high_err.contains("cooling down"));
        assert!(high_err.contains("memory pressure high"));

        let critical_cooldown = runtime.note_memory_pressure("Facebook", "feed scrape", true);
        assert!(critical_cooldown >= high_cooldown);
        let critical_err = runtime.begin_job("fb_visit_url").unwrap_err();
        assert!(critical_err.contains("cooling down"));
        assert!(critical_err.contains("memory pressure critical"));
    }

    #[test]
    fn mark_startup_failed_forces_recovery_on_next_launch() {
        let temp = tempfile::tempdir().unwrap();
        mark_startup_success(temp.path());
        mark_startup_failed(temp.path());
        let state = load_startup_recovery_state(temp.path());

        assert!(startup_requires_recovery(&state));
        assert_eq!(state.consecutive_failed_boots, 1);
        assert!(state.last_failed_boot_at_ms.is_some());
    }

    #[test]
    fn bounded_jsonl_retains_tail_when_file_exceeds_budget() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("runtime-health.jsonl");
        std::fs::write(
            &path,
            [
                "old-0",
                "old-1",
                "old-2",
                "old-3",
                "old-4",
                "old-5",
                "old-6",
                "old-7",
                "old-8",
                "old-9",
            ]
            .join("\n"),
        )
        .unwrap();

        append_bounded_jsonl(&path, "fresh", 24).unwrap();

        let retained = std::fs::read_to_string(&path).unwrap();
        assert!(!retained.contains("old-0"));
        assert!(retained.contains("old-8"));
        assert!(retained.ends_with("fresh\n"));
    }

    #[test]
    fn app_storage_path_filter_excludes_safari_cache() {
        let roots = vec![
            PathBuf::from("/Users/aubrey/Library/Caches/wtf.freed.desktop"),
            PathBuf::from("/Users/aubrey/Library/Application Support/wtf.freed.desktop"),
        ];

        assert!(path_is_under_any_root(
            Path::new(
                "/Users/aubrey/Library/Caches/wtf.freed.desktop/WebKit/NetworkCache/Version 17/Blobs/a"
            ),
            &roots,
        ));
        assert!(path_is_under_any_root(
            Path::new("/Users/aubrey/Library/Application Support/wtf.freed.desktop/IndexedDB/file"),
            &roots,
        ));
        assert!(!path_is_under_any_root(
            Path::new(
                "/Users/aubrey/Library/Containers/com.apple.Safari/Data/Library/Caches/com.apple.Safari/WebKitCache/Version 17/Blobs/a"
            ),
            &roots,
        ));
    }

    #[test]
    fn social_scraper_data_stores_are_provider_specific() {
        assert_eq!(
            social_scraper_data_store_identifier("fb-scraper"),
            Some(FB_SCRAPER_DATA_STORE_IDENTIFIER)
        );
        assert_eq!(
            social_scraper_data_store_identifier("ig-scraper"),
            Some(IG_SCRAPER_DATA_STORE_IDENTIFIER)
        );
        assert_eq!(
            social_scraper_data_store_identifier("li-scraper"),
            Some(LI_SCRAPER_DATA_STORE_IDENTIFIER)
        );
        assert_eq!(social_scraper_data_store_identifier("main"), None);

        let unique = HashSet::from([
            FB_SCRAPER_DATA_STORE_IDENTIFIER,
            IG_SCRAPER_DATA_STORE_IDENTIFIER,
            LI_SCRAPER_DATA_STORE_IDENTIFIER,
        ]);
        assert_eq!(unique.len(), 3);
    }

    #[test]
    fn webkit_process_filter_excludes_prior_launches() {
        let app_age = 60;

        assert!(webkit_process_belongs_to_current_launch(0, app_age));
        assert!(webkit_process_belongs_to_current_launch(
            app_age + WEBKIT_PROCESS_START_GRACE_SECONDS,
            app_age
        ));
        assert!(!webkit_process_belongs_to_current_launch(
            app_age + WEBKIT_PROCESS_START_GRACE_SECONDS + 1,
            app_age
        ));
    }

    #[test]
    fn webkit_network_cache_collection_includes_record_resources() {
        let temp = tempfile::tempdir().unwrap();
        let network_cache_root = temp
            .path()
            .join("WebKit/NetworkCache/Version 17/Records/hash/Resource");
        std::fs::create_dir_all(&network_cache_root).unwrap();
        let record_file = network_cache_root.join("resource-blob");
        std::fs::write(&record_file, b"record").unwrap();

        let mut files = Vec::new();
        collect_webkit_network_cache_files(&temp.path().join("WebKit/NetworkCache"), &mut files);

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].0, record_file);
    }

    #[test]
    fn webkit_network_cache_trimmer_removes_large_records_cache() {
        let temp = tempfile::tempdir().unwrap();
        let record_root = temp
            .path()
            .join("WebKit/NetworkCache/Version 17/Records/hash/Resource");
        std::fs::create_dir_all(&record_root).unwrap();
        let record_file = record_root.join("large-resource");
        let file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .open(&record_file)
            .unwrap();
        file.set_len(WEBKIT_CACHE_TRIM_AT_BYTES + 1).unwrap();

        let result = trim_webkit_network_cache_root_with_result(&temp.path().join("WebKit"));

        assert!(result.cache_trimmed);
        assert!(result.before_bytes > WEBKIT_CACHE_TRIM_AT_BYTES);
        assert!(result.after_bytes <= WEBKIT_CACHE_TRIM_TARGET_BYTES);
        assert!(!record_file.exists());
    }

    #[test]
    fn local_ai_download_urls_are_restricted_to_hugging_face() {
        assert!(validate_local_ai_download_url(
            "https://huggingface.co/onnx-community/model/resolve/rev/file.onnx"
        )
        .is_ok());
        assert!(validate_local_ai_download_url("http://huggingface.co/model").is_err());
        assert!(validate_local_ai_download_url("https://example.com/model").is_err());
    }

    #[test]
    fn local_ai_model_paths_must_stay_under_model_root() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("local-ai-models");
        std::fs::create_dir_all(&root).unwrap();
        let allowed = root.join("integrated-balanced/rev/model.bin");
        let denied = temp.path().join("other/model.bin");

        assert!(validate_local_ai_model_path(&root, &allowed, "targetPath").is_ok());
        assert!(validate_local_ai_model_path(&root, &denied, "targetPath").is_err());
    }

    #[test]
    fn scrape_memory_blocks_when_after_cleanup_is_still_high() {
        let stats = RuntimeMemoryStats {
            total_physical_memory_bytes: 16 * BYTES_PER_GIB,
            process_resident_bytes: 128,
            process_footprint_bytes: Some(128),
            process_virtual_bytes: 256,
            app_resident_bytes: (MIN_CRITICAL_MEMORY_BYTES * 70 / 100)
                - SCRAPE_MEMORY_HEADROOM_BYTES
                - 1,
            app_memory_pressure_bytes: (MIN_CRITICAL_MEMORY_BYTES * 70 / 100)
                - SCRAPE_MEMORY_HEADROOM_BYTES
                - 1,
            webkit_resident_bytes: None,
            webkit_footprint_bytes: None,
            webkit_virtual_bytes: None,
            webkit_process_id: None,
            webkit_total_resident_bytes: 0,
            webkit_total_footprint_bytes: None,
            webkit_process_count: 0,
            webkit_largest_resident_bytes: None,
            webkit_largest_footprint_bytes: None,
            webkit_largest_process_id: None,
            webkit_largest_cpu_usage: None,
            webkit_largest_age_seconds: None,
            webkit_largest_role: None,
            webkit_processes: Vec::new(),
            webkit_telemetry_available: false,
            indexed_db_bytes: None,
            webkit_cache_bytes: None,
            memory_high_bytes: MIN_CRITICAL_MEMORY_BYTES * 70 / 100,
            memory_critical_bytes: MIN_CRITICAL_MEMORY_BYTES,
            relay_doc_bytes: 0,
            relay_client_count: 0,
        };

        assert!(scrape_memory_may_proceed(&stats));
        assert!(!scrape_memory_may_proceed(&RuntimeMemoryStats {
            app_resident_bytes: MIN_CRITICAL_MEMORY_BYTES * 70 / 100,
            app_memory_pressure_bytes: MIN_CRITICAL_MEMORY_BYTES * 70 / 100,
            ..stats
        }));
    }

    #[test]
    fn scrape_memory_uses_pressure_bytes_instead_of_rss_when_available() {
        let budget =
            (MIN_CRITICAL_MEMORY_BYTES * 70 / 100).saturating_sub(SCRAPE_MEMORY_HEADROOM_BYTES);
        let stats = RuntimeMemoryStats {
            total_physical_memory_bytes: 16 * BYTES_PER_GIB,
            process_resident_bytes: 128,
            process_footprint_bytes: Some(128),
            process_virtual_bytes: 256,
            app_resident_bytes: MIN_CRITICAL_MEMORY_BYTES,
            app_memory_pressure_bytes: budget - 1,
            webkit_resident_bytes: Some(MIN_CRITICAL_MEMORY_BYTES),
            webkit_footprint_bytes: Some(512 * 1024 * 1024),
            webkit_virtual_bytes: None,
            webkit_process_id: Some(123),
            webkit_total_resident_bytes: MIN_CRITICAL_MEMORY_BYTES,
            webkit_total_footprint_bytes: Some(512 * 1024 * 1024),
            webkit_process_count: 1,
            webkit_largest_resident_bytes: Some(MIN_CRITICAL_MEMORY_BYTES),
            webkit_largest_footprint_bytes: Some(512 * 1024 * 1024),
            webkit_largest_process_id: Some(123),
            webkit_largest_cpu_usage: Some(0.0),
            webkit_largest_age_seconds: Some(10),
            webkit_largest_role: Some("freed-webcontent".to_string()),
            webkit_processes: Vec::new(),
            webkit_telemetry_available: true,
            indexed_db_bytes: None,
            webkit_cache_bytes: None,
            memory_high_bytes: MIN_CRITICAL_MEMORY_BYTES * 70 / 100,
            memory_critical_bytes: MIN_CRITICAL_MEMORY_BYTES,
            relay_doc_bytes: 0,
            relay_client_count: 0,
        };

        assert!(scrape_memory_may_proceed(&stats));
        assert!(!scrape_memory_may_proceed(&RuntimeMemoryStats {
            app_memory_pressure_bytes: budget,
            ..stats
        }));
    }

    #[test]
    fn scrape_memory_reserves_startup_headroom_below_high_pressure() {
        let stats = RuntimeMemoryStats {
            total_physical_memory_bytes: 16 * BYTES_PER_GIB,
            process_resident_bytes: 128,
            process_footprint_bytes: Some(128),
            process_virtual_bytes: 256,
            app_resident_bytes: 0,
            app_memory_pressure_bytes: 0,
            webkit_resident_bytes: None,
            webkit_footprint_bytes: None,
            webkit_virtual_bytes: None,
            webkit_process_id: None,
            webkit_total_resident_bytes: 0,
            webkit_total_footprint_bytes: None,
            webkit_process_count: 0,
            webkit_largest_resident_bytes: None,
            webkit_largest_footprint_bytes: None,
            webkit_largest_process_id: None,
            webkit_largest_cpu_usage: None,
            webkit_largest_age_seconds: None,
            webkit_largest_role: None,
            webkit_processes: Vec::new(),
            webkit_telemetry_available: false,
            indexed_db_bytes: None,
            webkit_cache_bytes: None,
            memory_high_bytes: MIN_CRITICAL_MEMORY_BYTES * 70 / 100,
            memory_critical_bytes: MIN_CRITICAL_MEMORY_BYTES,
            relay_doc_bytes: 0,
            relay_client_count: 0,
        };
        let budget = scrape_memory_start_budget_bytes(&stats);

        assert_eq!(
            budget,
            stats.memory_high_bytes - SCRAPE_MEMORY_HEADROOM_BYTES
        );
        assert!(!scrape_memory_may_proceed(&RuntimeMemoryStats {
            app_resident_bytes: budget,
            app_memory_pressure_bytes: budget,
            ..stats
        }));
    }

    #[test]
    fn scrape_memory_recycles_preserved_window_under_high_pressure() {
        assert_eq!(
            blocked_preflight_preserved_scraper_label(Some("ig-scraper"), false),
            Some("ig-scraper")
        );
        assert_eq!(
            blocked_preflight_preserved_scraper_label(Some("ig-scraper"), true),
            None
        );
        assert_eq!(blocked_preflight_preserved_scraper_label(None, false), None);
    }

    #[test]
    fn optional_story_scrape_uses_stricter_memory_budget() {
        let stats = RuntimeMemoryStats {
            total_physical_memory_bytes: 16 * BYTES_PER_GIB,
            process_resident_bytes: 128,
            process_footprint_bytes: Some(128),
            process_virtual_bytes: 256,
            app_resident_bytes: (MIN_CRITICAL_MEMORY_BYTES * 70 / 100)
                * OPTIONAL_STORY_MEMORY_BUDGET_PERCENT
                / 100
                - 1,
            app_memory_pressure_bytes: (MIN_CRITICAL_MEMORY_BYTES * 70 / 100)
                * OPTIONAL_STORY_MEMORY_BUDGET_PERCENT
                / 100
                - 1,
            webkit_resident_bytes: None,
            webkit_footprint_bytes: None,
            webkit_virtual_bytes: None,
            webkit_process_id: None,
            webkit_total_resident_bytes: 0,
            webkit_total_footprint_bytes: None,
            webkit_process_count: 0,
            webkit_largest_resident_bytes: None,
            webkit_largest_footprint_bytes: None,
            webkit_largest_process_id: None,
            webkit_largest_cpu_usage: None,
            webkit_largest_age_seconds: None,
            webkit_largest_role: None,
            webkit_processes: Vec::new(),
            webkit_telemetry_available: false,
            indexed_db_bytes: None,
            webkit_cache_bytes: None,
            memory_high_bytes: MIN_CRITICAL_MEMORY_BYTES * 70 / 100,
            memory_critical_bytes: MIN_CRITICAL_MEMORY_BYTES,
            relay_doc_bytes: 0,
            relay_client_count: 0,
        };

        assert!(optional_story_scrape_may_proceed(&stats));
        assert!(!optional_story_scrape_may_proceed(&RuntimeMemoryStats {
            app_resident_bytes: stats
                .memory_high_bytes
                .saturating_mul(OPTIONAL_STORY_MEMORY_BUDGET_PERCENT)
                / 100,
            app_memory_pressure_bytes: stats
                .memory_high_bytes
                .saturating_mul(OPTIONAL_STORY_MEMORY_BUDGET_PERCENT)
                / 100,
            ..stats
        }));
    }

    #[test]
    fn reconcile_marks_unfinished_boot_as_failed() {
        let temp = tempfile::tempdir().unwrap();

        save_startup_recovery_state(
            temp.path(),
            &StartupRecoveryState {
                consecutive_failed_boots: 0,
                pending_boot_started_at_ms: Some(123),
                last_failed_boot_at_ms: None,
                last_successful_boot_at_ms: None,
            },
        );

        let state = reconcile_startup_recovery_state(temp.path());

        assert_eq!(state.consecutive_failed_boots, 1);
        assert!(state.pending_boot_started_at_ms.is_none());
        assert!(state.last_failed_boot_at_ms.is_some());
    }

    #[test]
    fn mark_startup_success_clears_recovery_state() {
        let temp = tempfile::tempdir().unwrap();

        save_startup_recovery_state(
            temp.path(),
            &StartupRecoveryState {
                consecutive_failed_boots: 2,
                pending_boot_started_at_ms: Some(456),
                last_failed_boot_at_ms: Some(789),
                last_successful_boot_at_ms: None,
            },
        );

        mark_startup_success(temp.path());

        let state = load_startup_recovery_state(temp.path());
        assert_eq!(state.consecutive_failed_boots, 0);
        assert!(state.pending_boot_started_at_ms.is_none());
        assert!(state.last_successful_boot_at_ms.is_some());
    }
}
