//! Freed Desktop Application
//!
//! Native desktop app that bundles capture, sync relay, and reader UI.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::{SinkExt, StreamExt};
use log::{error, info, warn};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
#[cfg(target_os = "macos")]
use std::mem::MaybeUninit;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex as StdMutex, RwLock as StdRwLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use sysinfo::{Disks, Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::menu::{Menu, MenuItem};
#[cfg(target_os = "macos")]
use tauri::menu::{PredefinedMenuItem, Submenu};
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
use objc2_foundation::{ns_string, MainThreadMarker, NSObjectNSKeyValueCoding, NSRect, NSString};
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
const MAX_CRITICAL_MEMORY_BYTES: u64 = 12 * BYTES_PER_GIB;
const WEBKIT_CACHE_TRIM_AT_BYTES: u64 = 768 * 1024 * 1024;
const WEBKIT_CACHE_TRIM_TARGET_BYTES: u64 = 512 * 1024 * 1024;
const OPTIONAL_STORY_MEMORY_BUDGET_PERCENT: u64 = 85;
const SCRAPE_MEMORY_HEADROOM_BYTES: u64 = 384 * 1024 * 1024;
const SCRAPE_REDUCED_PASS_MARGIN_BYTES: u64 = 1536 * 1024 * 1024;
const SCRAPE_MINIMAL_PASS_MARGIN_BYTES: u64 = 768 * 1024 * 1024;
const POST_SOCIAL_SCRAPE_WEBKIT_FOOTPRINT_RECOVERY_BYTES: u64 = 2 * BYTES_PER_GIB;
const POST_SOCIAL_SCRAPE_WEBKIT_FOOTPRINT_GROWTH_BYTES: u64 = 768 * 1024 * 1024;
const POST_SOCIAL_SCRAPE_WEBKIT_RESIDENT_RECOVERY_BYTES: u64 = 4 * BYTES_PER_GIB;
const POST_SOCIAL_SCRAPE_PRESSURE_RECOVERY_PERCENT: u64 = 35;
const WEBKIT_PROCESS_START_GRACE_SECONDS: u64 = 10;
const STARTUP_RECOVERY_STATE_FILE: &str = "startup-recovery.json";
const RUNTIME_HEALTH_FILE: &str = "runtime-health.jsonl";
const DEV_SYNC_TRIGGER_FILE: &str = "dev-sync-trigger.json";
const DEV_SYNC_TRIGGER_RESULT_FILE: &str = "dev-sync-trigger-result.json";
const DEV_SYNC_TRIGGER_POLL_INTERVAL: Duration = Duration::from_secs(5);
const DEV_SYNC_TRIGGER_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(2);
const DEV_SYNC_TRIGGER_KEEPALIVE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const DEV_SYNC_TRIGGER_REQUEST_MAX_AGE_MS: u64 = 10 * 60 * 1000;
const RUNTIME_HEALTH_MAX_BYTES: u64 = 5 * 1024 * 1024;
const RUNTIME_DIAGNOSTICS_FILE: &str = "runtime-diagnostics.jsonl";
const RUNTIME_DIAGNOSTICS_MAX_BYTES: u64 = 5 * 1024 * 1024;
const RUNTIME_DIAGNOSTICS_COOLDOWN: Duration = Duration::from_secs(180);
const STARTUP_DIAGNOSTICS_MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const RECOVERY_WINDOW_LABEL: &str = "startup-recovery";
const RECOVERY_WINDOW_ROUTE: &str = "startup-recovery.html";
const RENDERER_HEARTBEAT_WATCHDOG_INTERVAL: Duration = Duration::from_secs(15);
const RENDERER_HEARTBEAT_MEMORY_SAMPLE_INTERVAL: Duration = Duration::from_secs(60);
const RENDERER_STALE_LOG_AFTER: Duration = Duration::from_secs(45);
const WEBKIT_HIDDEN_TIMER_THROTTLE_AFTER: Duration = Duration::from_secs(480);
const RENDERER_HIDDEN_STALE_LOG_AFTER: Duration = Duration::from_secs(570);
const RENDERER_VISIBLE_RECOVERY_AFTER: Duration = Duration::from_secs(75);
const RENDERER_HIDDEN_RECOVERY_AFTER: Duration = Duration::from_secs(900);
const MAIN_RENDERER_MEMORY_RECOVERY_MIN_AGE_SECONDS: u64 = 5 * 60;
const RENDERER_EVENT_LOOP_LAG_RECOVERY_MS: f64 = 45_000.0;
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
const MAIN_WINDOW_OCCLUSION_RECOVERY_AFTER: Duration = Duration::from_secs(5);
const NS_WINDOW_OCCLUSION_STATE_VISIBLE: usize = 1 << 1;
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
        "fb-login" | "fb-scraper" => Some(FB_SCRAPER_DATA_STORE_IDENTIFIER),
        "ig-scraper" => Some(IG_SCRAPER_DATA_STORE_IDENTIFIER),
        "li-scraper" => Some(LI_SCRAPER_DATA_STORE_IDENTIFIER),
        _ => None,
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SocialProviderCookieState {
    provider: String,
    available: bool,
    has_auth_cookie: bool,
    cookie_count: usize,
    cookie_names: Vec<String>,
    error: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSessionState {
    available: bool,
    screen_locked: bool,
    error: Option<String>,
}

#[cfg(target_os = "macos")]
fn parse_screen_locked_from_ioreg_plist(text: &str) -> Option<bool> {
    let locked_key = "<key>CGSSessionScreenIsLocked</key>";
    text.split(locked_key)
        .nth(1)
        .map(|tail| tail.trim_start().starts_with("<true/>"))
}

fn data_store_identifier_folder(identifier: [u8; 16]) -> String {
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        identifier[0],
        identifier[1],
        identifier[2],
        identifier[3],
        identifier[4],
        identifier[5],
        identifier[6],
        identifier[7],
        identifier[8],
        identifier[9],
        identifier[10],
        identifier[11],
        identifier[12],
        identifier[13],
        identifier[14],
        identifier[15],
    )
}

fn social_auth_cookie_config(
    provider: &str,
) -> Option<(&'static str, [u8; 16], &'static [&'static str])> {
    match provider {
        "facebook" => Some((
            "facebook",
            FB_SCRAPER_DATA_STORE_IDENTIFIER,
            &["c_user", "xs"],
        )),
        "instagram" => Some((
            "instagram",
            IG_SCRAPER_DATA_STORE_IDENTIFIER,
            &["sessionid"],
        )),
        "linkedin" => Some(("linkedin", LI_SCRAPER_DATA_STORE_IDENTIFIER, &["li_at"])),
        _ => None,
    }
}

fn read_u32_be(data: &[u8], offset: usize) -> Option<u32> {
    let bytes = data.get(offset..offset + 4)?;
    Some(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn read_u32_le(data: &[u8], offset: usize) -> Option<u32> {
    let bytes = data.get(offset..offset + 4)?;
    Some(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn cookie_record_string(record: &[u8], offset: usize) -> Option<String> {
    if offset == 0 || offset >= record.len() {
        return None;
    }
    let end = record[offset..]
        .iter()
        .position(|byte| *byte == 0)
        .map(|relative| offset + relative)
        .unwrap_or(record.len());
    std::str::from_utf8(record.get(offset..end)?)
        .ok()
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

fn parse_webkit_binary_cookie_names(data: &[u8]) -> Result<Vec<String>, String> {
    if data.len() < 8 || data.get(0..4) != Some(b"cook") {
        return Err("Invalid WebKit cookie store header".to_string());
    }

    let page_count = read_u32_be(data, 4).ok_or_else(|| "Missing page count".to_string())? as usize;
    let sizes_start = 8usize;
    let sizes_end = sizes_start
        .checked_add(page_count.saturating_mul(4))
        .ok_or_else(|| "Cookie page table is too large".to_string())?;
    if sizes_end > data.len() {
        return Err("Cookie page table exceeds file size".to_string());
    }

    let mut page_sizes = Vec::with_capacity(page_count);
    for index in 0..page_count {
        let offset = sizes_start + index * 4;
        page_sizes.push(read_u32_be(data, offset).unwrap_or(0) as usize);
    }

    let mut names = HashSet::new();
    let mut page_start = sizes_end;
    for page_size in page_sizes {
        let Some(page_end) = page_start.checked_add(page_size) else {
            break;
        };
        let Some(page) = data.get(page_start..page_end) else {
            break;
        };
        page_start = page_end;

        if page.len() < 8 {
            continue;
        }
        let cookie_count = read_u32_le(page, 4).unwrap_or(0) as usize;
        for index in 0..cookie_count {
            let offset_offset = 8 + index * 4;
            let Some(record_offset) = read_u32_le(page, offset_offset).map(|value| value as usize)
            else {
                continue;
            };
            let Some(record_size) = read_u32_le(page, record_offset).map(|value| value as usize)
            else {
                continue;
            };
            if record_size == 0 {
                continue;
            }
            let Some(record_end) = record_offset.checked_add(record_size) else {
                continue;
            };
            let Some(record) = page.get(record_offset..record_end) else {
                continue;
            };
            let Some(name_offset) = read_u32_le(record, 20).map(|value| value as usize) else {
                continue;
            };
            if let Some(name) = cookie_record_string(record, name_offset) {
                names.insert(name);
            }
        }
    }

    let mut names: Vec<String> = names.into_iter().collect();
    names.sort();
    Ok(names)
}

#[cfg(target_os = "macos")]
fn webkit_cookie_store_path(
    app: &tauri::AppHandle,
    identifier: [u8; 16],
) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    Ok(home
        .join("Library")
        .join("WebKit")
        .join(app.config().identifier.as_str())
        .join("WebsiteDataStore")
        .join(data_store_identifier_folder(identifier))
        .join("Cookies")
        .join("Cookies.binarycookies"))
}

#[tauri::command]
fn get_social_provider_cookie_state(
    app: tauri::AppHandle,
    provider: String,
) -> Result<SocialProviderCookieState, String> {
    let Some((provider, identifier, auth_cookie_names)) =
        social_auth_cookie_config(provider.as_str())
    else {
        return Err(format!("Unsupported social provider: {}", provider));
    };

    #[cfg(not(target_os = "macos"))]
    {
        return Ok(SocialProviderCookieState {
            provider: provider.to_string(),
            available: false,
            has_auth_cookie: false,
            cookie_count: 0,
            cookie_names: Vec::new(),
            error: Some("Provider cookie diagnostics are only available on macOS.".to_string()),
        });
    }

    #[cfg(target_os = "macos")]
    {
        let path = webkit_cookie_store_path(&app, identifier)?;
        let data = match std::fs::read(&path) {
            Ok(data) => data,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(SocialProviderCookieState {
                    provider: provider.to_string(),
                    available: false,
                    has_auth_cookie: false,
                    cookie_count: 0,
                    cookie_names: Vec::new(),
                    error: None,
                });
            }
            Err(error) => {
                return Ok(SocialProviderCookieState {
                    provider: provider.to_string(),
                    available: false,
                    has_auth_cookie: false,
                    cookie_count: 0,
                    cookie_names: Vec::new(),
                    error: Some(error.to_string()),
                });
            }
        };

        let cookie_names = match parse_webkit_binary_cookie_names(&data) {
            Ok(cookie_names) => cookie_names,
            Err(error) => {
                return Ok(SocialProviderCookieState {
                    provider: provider.to_string(),
                    available: false,
                    has_auth_cookie: false,
                    cookie_count: 0,
                    cookie_names: Vec::new(),
                    error: Some(error),
                });
            }
        };
        let has_auth_cookie = cookie_names
            .iter()
            .any(|name| auth_cookie_names.iter().any(|auth_name| name == auth_name));

        Ok(SocialProviderCookieState {
            provider: provider.to_string(),
            available: true,
            has_auth_cookie,
            cookie_count: cookie_names.len(),
            cookie_names,
            error: None,
        })
    }
}

#[tauri::command]
fn get_desktop_session_state() -> DesktopSessionState {
    #[cfg(not(target_os = "macos"))]
    {
        return DesktopSessionState {
            available: false,
            screen_locked: false,
            error: Some("Desktop session diagnostics are only available on macOS.".to_string()),
        };
    }

    #[cfg(target_os = "macos")]
    {
        let output = match std::process::Command::new("/usr/sbin/ioreg")
            .args(["-a", "-d", "1", "-c", "IORegistryEntry"])
            .output()
        {
            Ok(output) => output,
            Err(error) => {
                return DesktopSessionState {
                    available: false,
                    screen_locked: false,
                    error: Some(error.to_string()),
                };
            }
        };

        if !output.status.success() {
            return DesktopSessionState {
                available: false,
                screen_locked: false,
                error: Some(format!("ioreg exited with status {}", output.status)),
            };
        }

        let text = String::from_utf8_lossy(&output.stdout);
        let screen_locked = parse_screen_locked_from_ioreg_plist(&text).unwrap_or(false);

        DesktopSessionState {
            available: parse_screen_locked_from_ioreg_plist(&text).is_some(),
            screen_locked,
            error: None,
        }
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

fn active_job_uses_social_scraper(active_job: Option<&str>) -> bool {
    active_job
        .map(|operation| {
            operation.starts_with("fb_")
                || operation.starts_with("ig_")
                || operation.starts_with("li_")
        })
        .unwrap_or(false)
}

fn recycle_social_scraper_windows_unless_active(
    app: &tauri::AppHandle,
    runtime: &BackgroundRuntimeCoordinator,
    reason: &str,
) {
    let (active_job, active_job_age_ms) = runtime.active_job_for_health();
    if active_job_uses_social_scraper(active_job) {
        info!(
            "[window] deferred scraper recycle ({}) active_op={} active_age_ms={}",
            reason,
            active_job.unwrap_or("unknown"),
            active_job_age_ms.unwrap_or(0)
        );
        return;
    }

    recycle_social_scraper_windows(app, reason);
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

fn unix_millis_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn emit_social_scrape_lifecycle(
    app: &tauri::AppHandle,
    event_name: &str,
    provider: &str,
    window: Option<&tauri::WebviewWindow>,
    window_mode: ScraperWindowMode,
    reason: Option<&str>,
) {
    let _ = app.emit(
        event_name,
        serde_json::json!({
            "provider": provider,
            "windowMode": window_mode.as_str(),
            "nativeVisible": window.and_then(|wv| wv.is_visible().ok()),
            "nativeFocused": window.and_then(|wv| wv.is_focused().ok()),
            "scrollInput": "script-scroll",
            "clickInput": "script-click",
            "reason": reason,
            "emittedAt": unix_millis_now()
        }),
    );
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
    let _ = window.eval("window.scrollTo({ top: 0, behavior: 'auto' });");
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

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevSyncTriggerRequest {
    enabled: Option<bool>,
    id: Option<String>,
    provider: Option<String>,
    created_at: Option<u64>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevSyncTriggerResult {
    id: String,
    provider: Option<String>,
    status: String,
    detail: Option<String>,
    updated_at: u64,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopReleaseChannelState {
    channel: Option<String>,
    selected_channel: Option<String>,
    installed_channel: Option<String>,
}

fn dev_sync_trigger_path(data_dir: &Path) -> PathBuf {
    data_dir.join(DEV_SYNC_TRIGGER_FILE)
}

fn dev_sync_trigger_result_path(data_dir: &Path) -> PathBuf {
    data_dir.join(DEV_SYNC_TRIGGER_RESULT_FILE)
}

fn load_dev_sync_trigger_request(data_dir: &Path) -> Option<DevSyncTriggerRequest> {
    let raw = std::fs::read_to_string(dev_sync_trigger_path(data_dir)).ok()?;
    match serde_json::from_str::<DevSyncTriggerRequest>(&raw) {
        Ok(request) => Some(request),
        Err(error) => {
            warn!("[dev-sync-trigger] failed to parse request: {}", error);
            None
        }
    }
}

fn write_dev_sync_trigger_result(
    data_dir: &Path,
    id: &str,
    provider: Option<&str>,
    status: &str,
    detail: Option<&str>,
) {
    let result = DevSyncTriggerResult {
        id: id.to_string(),
        provider: provider.map(|value| value.to_string()),
        status: status.to_string(),
        detail: detail.map(|value| value.to_string()),
        updated_at: now_unix_ms(),
    };
    let Ok(serialized) = serde_json::to_vec_pretty(&result) else {
        warn!("[dev-sync-trigger] failed to serialize result id={}", id);
        return;
    };
    if let Err(error) = std::fs::write(dev_sync_trigger_result_path(data_dir), serialized) {
        warn!(
            "[dev-sync-trigger] failed to write result id={} status={}: {}",
            id, status, error
        );
    }
}

fn load_dev_sync_trigger_result_status(data_dir: &Path, id: &str) -> Option<String> {
    let raw = std::fs::read_to_string(dev_sync_trigger_result_path(data_dir)).ok()?;
    let result = serde_json::from_str::<DevSyncTriggerResult>(&raw).ok()?;
    (result.id == id).then_some(result.status)
}

fn is_current_dev_sync_trigger_request(data_dir: &Path, id: &str) -> bool {
    load_dev_sync_trigger_request(data_dir)
        .and_then(|request| request.id)
        .as_deref()
        == Some(id)
}

fn write_current_dev_sync_trigger_result(
    data_dir: &Path,
    id: &str,
    provider: Option<&str>,
    status: &str,
    detail: Option<&str>,
) -> bool {
    if !is_current_dev_sync_trigger_request(data_dir, id) {
        info!(
            "[dev-sync-trigger] ignored stale result id={} status={}",
            id, status
        );
        return false;
    }
    write_dev_sync_trigger_result(data_dir, id, provider, status, detail);
    true
}

fn is_dev_sync_trigger_terminal_status(status: &str) -> bool {
    matches!(status, "completed" | "error" | "ignored")
}

fn is_supported_dev_sync_provider(provider: &str) -> bool {
    matches!(provider, "facebook" | "instagram" | "linkedin")
}

fn dev_sync_trigger_request_expiration_detail(
    request: &DevSyncTriggerRequest,
    now_ms: u64,
) -> Option<&'static str> {
    let Some(created_at) = request.created_at else {
        return Some("Trigger request is missing createdAt. Re-run scripts/dev-sync-trigger.mjs.");
    };
    if now_ms.saturating_sub(created_at) > DEV_SYNC_TRIGGER_REQUEST_MAX_AGE_MS {
        return Some("Trigger request expired before Freed Desktop picked it up. Re-run scripts/dev-sync-trigger.mjs.");
    }
    None
}

fn dev_sync_triggers_enabled(data_dir: &Path) -> bool {
    if std::env::var("FREED_ENABLE_DEV_SYNC_TRIGGERS")
        .ok()
        .as_deref()
        == Some("1")
    {
        return true;
    }

    if cfg!(debug_assertions) {
        return true;
    }

    let raw = match std::fs::read_to_string(data_dir.join("release-channel.json")) {
        Ok(raw) => raw,
        Err(_) => return false,
    };
    let Ok(state) = serde_json::from_str::<DesktopReleaseChannelState>(&raw) else {
        return false;
    };
    state.channel.as_deref() == Some("dev")
        || state.selected_channel.as_deref() == Some("dev")
        || state.installed_channel.as_deref() == Some("dev")
}

fn escape_js_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn dispatch_dev_sync_trigger_to_renderer(
    app: &tauri::AppHandle,
    request_id: &str,
    provider: &str,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Err("main renderer is not available".to_string());
    };
    let payload = serde_json::json!({
        "id": request_id,
        "provider": provider
    });
    let payload = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
    let event_name = escape_js_string("dev-sync-trigger-native-result");
    let missing_detail = escape_js_string("renderer sync trigger bridge is not registered");
    let bridge_wait_timeout_ms = 120_000;
    let script = format!(
        r#"(function() {{
  var request = {payload};
  var startedAt = Date.now();
  var emitResult = function(status, detail) {{
    try {{
      if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.emit) {{
        window.__TAURI__.event.emit({event_name}, {{
          id: request.id,
          provider: request.provider,
          status: status,
          detail: detail || null,
          updatedAt: Date.now()
        }});
      }}
    }} catch (_) {{}}
  }};
  var waitForBridge = function() {{
    var run = window.__FREED_RUN_SOCIAL_SYNC__;
    if (typeof run === "function") {{
      Promise.resolve(run(request)).catch(function(error) {{
        emitResult("error", error && error.message ? error.message : String(error));
      }});
      return;
    }}
    if (Date.now() - startedAt > {bridge_wait_timeout_ms}) {{
      emitResult("error", {missing_detail});
      return;
    }}
    emitResult("waiting", {missing_detail});
    window.setTimeout(waitForBridge, 250);
  }};
  waitForBridge();
}})();"#
    );
    window.eval(&script).map_err(|error| error.to_string())
}

fn start_dev_sync_trigger_keepalive(app: tauri::AppHandle, data_dir: PathBuf, request_id: String) {
    tauri::async_runtime::spawn(async move {
        let started_at = Instant::now();
        loop {
            tokio::time::sleep(DEV_SYNC_TRIGGER_KEEPALIVE_INTERVAL).await;
            if started_at.elapsed() > DEV_SYNC_TRIGGER_KEEPALIVE_TIMEOUT {
                warn!(
                    "[dev-sync-trigger] renderer keepalive timed out for request {}",
                    request_id
                );
                write_current_dev_sync_trigger_result(
                    &data_dir,
                    &request_id,
                    None,
                    "error",
                    Some("Renderer did not finish the sync trigger before the native timeout."),
                );
                return;
            }
            if load_dev_sync_trigger_result_status(&data_dir, &request_id)
                .as_deref()
                .map(is_dev_sync_trigger_terminal_status)
                .unwrap_or(false)
            {
                return;
            }
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = window.eval("window.__FREED_DEV_SYNC_KEEPALIVE__ = Date.now();");
            }
        }
    });
}

fn handle_dev_sync_trigger_result_event(data_dir: &Path, payload: &str) {
    let Ok(result) = serde_json::from_str::<DevSyncTriggerResult>(payload) else {
        warn!("[dev-sync-trigger] failed to parse renderer result payload");
        return;
    };
    write_current_dev_sync_trigger_result(
        data_dir,
        &result.id,
        result.provider.as_deref(),
        &result.status,
        result.detail.as_deref(),
    );
}

fn start_dev_sync_trigger_watcher(app: tauri::AppHandle, data_dir: PathBuf) {
    if !dev_sync_triggers_enabled(&data_dir) {
        info!("[dev-sync-trigger] native trigger watcher disabled");
        return;
    }

    info!("[dev-sync-trigger] native trigger watcher enabled");
    tauri::async_runtime::spawn(async move {
        let mut last_handled_id: Option<String> = None;
        loop {
            if let Some(request) = load_dev_sync_trigger_request(&data_dir) {
                if request.enabled.unwrap_or(false) {
                    if let Some(request_id) = request.id.as_deref().map(str::trim) {
                        if !request_id.is_empty() && last_handled_id.as_deref() != Some(request_id)
                        {
                            let provider = request.provider.as_deref().map(str::trim).unwrap_or("");
                            if let Some(detail) =
                                dev_sync_trigger_request_expiration_detail(&request, now_unix_ms())
                            {
                                last_handled_id = Some(request_id.to_string());
                                write_dev_sync_trigger_result(
                                    &data_dir,
                                    request_id,
                                    (!provider.is_empty()).then_some(provider),
                                    "ignored",
                                    Some(detail),
                                );
                                info!(
                                    "[dev-sync-trigger] ignored expired sync request {}",
                                    request_id
                                );
                            } else if !is_supported_dev_sync_provider(provider) {
                                last_handled_id = Some(request_id.to_string());
                                write_dev_sync_trigger_result(
                                    &data_dir,
                                    request_id,
                                    None,
                                    "ignored",
                                    Some("Unsupported provider. Use facebook, instagram, or linkedin."),
                                );
                            } else {
                                write_dev_sync_trigger_result(
                                    &data_dir,
                                    request_id,
                                    Some(provider),
                                    "started",
                                    Some("Dispatched by native trigger watcher"),
                                );
                                match dispatch_dev_sync_trigger_to_renderer(
                                    &app, request_id, provider,
                                ) {
                                    Ok(()) => {
                                        last_handled_id = Some(request_id.to_string());
                                        info!(
                                            "[dev-sync-trigger] dispatched {} sync request {}",
                                            provider, request_id
                                        );
                                        start_dev_sync_trigger_keepalive(
                                            app.clone(),
                                            data_dir.clone(),
                                            request_id.to_string(),
                                        );
                                    }
                                    Err(error) => {
                                        warn!(
                                            "[dev-sync-trigger] failed to dispatch request {}: {}",
                                            request_id, error
                                        );
                                        write_dev_sync_trigger_result(
                                            &data_dir,
                                            request_id,
                                            Some(provider),
                                            "waiting",
                                            Some(&error),
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
            tokio::time::sleep(DEV_SYNC_TRIGGER_POLL_INTERVAL).await;
        }
    });
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

fn prepare_startup_recovery_retry(data_dir: &Path) {
    let mut state = load_startup_recovery_state(data_dir);
    state.pending_boot_started_at_ms = Some(now_unix_ms());
    state.consecutive_failed_boots = 0;
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

fn read_recent_text_file(path: &Path, max_bytes: u64) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    let raw = std::fs::read(path).ok()?;
    let max_bytes = max_bytes as usize;
    let start = raw.len().saturating_sub(max_bytes);
    let tail = &raw[start..];
    let text = String::from_utf8_lossy(tail);
    if metadata.len() > max_bytes as u64 {
        Some(format!(
            "[truncated to latest {} bytes]\n{}",
            max_bytes, text
        ))
    } else {
        Some(text.into_owned())
    }
}

fn write_startup_diagnostics_bundle(
    data_dir: &Path,
    downloads_dir: &Path,
    version: &str,
    platform: &str,
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(downloads_dir)
        .map_err(|error| format!("failed to prepare downloads directory: {}", error))?;

    let filename = format!("freed-diagnostics-{}.json", now_unix_ms());
    let output_path = downloads_dir.join(filename);
    let diagnostics = serde_json::json!({
        "createdAtMs": now_unix_ms(),
        "version": version,
        "platform": platform,
        "startupRecovery": load_startup_recovery_state(data_dir),
        "runtimeHealth": read_recent_text_file(
            &runtime_health_path(data_dir),
            STARTUP_DIAGNOSTICS_MAX_FILE_BYTES,
        ),
        "runtimeDiagnostics": read_recent_text_file(
            &runtime_diagnostics_path(data_dir),
            STARTUP_DIAGNOSTICS_MAX_FILE_BYTES,
        ),
        "syncHealth": read_recent_text_file(
            &data_dir.join("sync-health.json"),
            STARTUP_DIAGNOSTICS_MAX_FILE_BYTES,
        ),
    });
    let serialized = serde_json::to_vec_pretty(&diagnostics)
        .map_err(|error| format!("failed to serialize diagnostics: {}", error))?;
    std::fs::write(&output_path, serialized)
        .map_err(|error| format!("failed to write diagnostics: {}", error))?;
    Ok(output_path)
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

#[derive(Clone, serde::Serialize)]
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
    webkit_attribution_precise: bool,
    indexed_db_bytes: Option<u64>,
    webkit_cache_bytes: Option<u64>,
    storage_sizes_sampled: bool,
    sample_duration_ms: u64,
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

#[derive(Clone, Copy)]
struct RuntimeMemoryStatsOptions {
    include_storage_sizes: bool,
    precise_webkit_attribution: bool,
}

impl RuntimeMemoryStatsOptions {
    fn full() -> Self {
        Self {
            include_storage_sizes: true,
            precise_webkit_attribution: true,
        }
    }
}

#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ScraperRecycleVerification {
    elapsed_ms: u64,
    before_process_ids: Vec<u32>,
    after_process_ids: Vec<u32>,
    exited_process_ids: Vec<u32>,
    retained_process_ids: Vec<u32>,
    new_process_ids: Vec<u32>,
    before_webkit_resident_bytes: u64,
    after_webkit_resident_bytes: u64,
    webkit_resident_delta_bytes: i64,
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
    scraper_recycle_verification: Option<ScraperRecycleVerification>,
    scrape_start_budget_bytes: u64,
    may_proceed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SocialScrapePlan {
    min_passes: usize,
    max_passes: usize,
    skip_stories: bool,
    reason: &'static str,
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
            state.cooldown_until = None;
            state.last_recovery_reason = None;
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

    fn pause_status_for_health(&self) -> (bool, Option<&'static str>, Option<u128>) {
        let now = Instant::now();
        let state = self.state.read().unwrap();

        if state.healthy_heartbeats < BACKGROUND_REQUIRED_HEALTHY_HEARTBEATS {
            return (true, Some("waiting_for_renderer_heartbeats"), None);
        }

        if state.renderer_stale {
            return (
                true,
                Some("renderer_stale"),
                state
                    .cooldown_until
                    .and_then(|until| (until > now).then(|| until.duration_since(now).as_millis())),
            );
        }

        if let Some(cooldown_until) = state.cooldown_until {
            if cooldown_until > now {
                return (
                    true,
                    Some("renderer_recovery_cooldown"),
                    Some(cooldown_until.duration_since(now).as_millis()),
                );
            }
        }

        if let Some(memory_cooldown_until) = state.memory_cooldown_until {
            if memory_cooldown_until > now {
                return (
                    true,
                    Some("memory_pressure_cooldown"),
                    Some(memory_cooldown_until.duration_since(now).as_millis()),
                );
            }
        }

        if let Some(safe_mode_until) = state.safe_mode_until {
            if safe_mode_until > now {
                return (
                    true,
                    Some("renderer_safe_mode"),
                    Some(safe_mode_until.duration_since(now).as_millis()),
                );
            }
        }

        (false, None, None)
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
    hidden_timer_throttled: Option<bool>,
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
    last_hidden_timer_throttled: Option<bool>,
    last_dom_node_count: Option<u64>,
    last_renderer_heap_used_bytes: Option<u64>,
    last_renderer_heap_total_bytes: Option<u64>,
    last_input_age_ms: Option<u64>,
    last_settings_open: Option<bool>,
    last_dialog_open: Option<bool>,
    stale_logged: bool,
    throttle_logged: bool,
    recovery_attempts: u64,
    last_recovery_at: Option<std::time::Instant>,
    renderer_generation: u64,
    recovery_history: VecDeque<std::time::Instant>,
}

#[derive(Debug, Clone)]
struct RendererMemorySample {
    sampled_at: std::time::Instant,
    process_resident_bytes: u64,
    process_footprint_bytes: Option<u64>,
    app_resident_bytes: u64,
    app_memory_pressure_bytes: u64,
    webkit_resident_bytes: u64,
    webkit_footprint_bytes: Option<u64>,
    webkit_largest_process_id: Option<u32>,
    webkit_largest_resident_bytes: Option<u64>,
    webkit_largest_footprint_bytes: Option<u64>,
    webkit_largest_cpu_usage: Option<f32>,
    webkit_largest_age_seconds: Option<u64>,
    webkit_largest_role: Option<String>,
    webkit_process_count: u64,
    webkit_telemetry_available: bool,
    memory_high_bytes: u64,
    memory_critical_bytes: u64,
}

impl RendererMemorySample {
    fn from_stats(sampled_at: std::time::Instant, stats: RuntimeMemoryStats) -> Self {
        Self {
            sampled_at,
            process_resident_bytes: stats.process_resident_bytes,
            process_footprint_bytes: stats.process_footprint_bytes,
            app_resident_bytes: stats.app_resident_bytes,
            app_memory_pressure_bytes: stats.app_memory_pressure_bytes,
            webkit_resident_bytes: stats.webkit_total_resident_bytes,
            webkit_footprint_bytes: stats.webkit_total_footprint_bytes,
            webkit_largest_process_id: stats.webkit_largest_process_id,
            webkit_largest_resident_bytes: stats.webkit_largest_resident_bytes,
            webkit_largest_footprint_bytes: stats.webkit_largest_footprint_bytes,
            webkit_largest_cpu_usage: stats.webkit_largest_cpu_usage,
            webkit_largest_age_seconds: stats.webkit_largest_age_seconds,
            webkit_largest_role: stats.webkit_largest_role,
            webkit_process_count: stats.webkit_process_count,
            webkit_telemetry_available: stats.webkit_telemetry_available,
            memory_high_bytes: stats.memory_high_bytes,
            memory_critical_bytes: stats.memory_critical_bytes,
        }
    }
}

fn renderer_memory_sample_due(
    last_sampled_at: Option<std::time::Instant>,
    now: std::time::Instant,
) -> bool {
    last_sampled_at
        .map(|last| now.duration_since(last) >= RENDERER_HEARTBEAT_MEMORY_SAMPLE_INTERVAL)
        .unwrap_or(true)
}

fn renderer_memory_health_fields(
    sample: Option<&RendererMemorySample>,
    now: std::time::Instant,
    refreshed: bool,
) -> serde_json::Map<String, serde_json::Value> {
    let mut fields = serde_json::Map::new();
    fields.insert(
        "nativeMemorySampleRefreshed".to_string(),
        serde_json::json!(refreshed),
    );

    if let Some(sample) = sample {
        fields.insert(
            "nativeMemorySampleAgeMs".to_string(),
            serde_json::json!(now.duration_since(sample.sampled_at).as_millis()),
        );
        fields.insert(
            "nativeResidentBytes".to_string(),
            serde_json::json!(sample.process_resident_bytes),
        );
        fields.insert(
            "nativeFootprintBytes".to_string(),
            serde_json::json!(sample.process_footprint_bytes),
        );
        fields.insert(
            "appResidentBytes".to_string(),
            serde_json::json!(sample.app_resident_bytes),
        );
        fields.insert(
            "appMemoryPressureBytes".to_string(),
            serde_json::json!(sample.app_memory_pressure_bytes),
        );
        fields.insert(
            "webkitResidentBytes".to_string(),
            serde_json::json!(sample.webkit_resident_bytes),
        );
        fields.insert(
            "webkitFootprintBytes".to_string(),
            serde_json::json!(sample.webkit_footprint_bytes),
        );
        fields.insert(
            "webkitLargestProcessId".to_string(),
            serde_json::json!(sample.webkit_largest_process_id),
        );
        fields.insert(
            "webkitLargestResidentBytes".to_string(),
            serde_json::json!(sample.webkit_largest_resident_bytes),
        );
        fields.insert(
            "webkitLargestFootprintBytes".to_string(),
            serde_json::json!(sample.webkit_largest_footprint_bytes),
        );
        fields.insert(
            "webkitLargestCpuUsage".to_string(),
            serde_json::json!(sample.webkit_largest_cpu_usage),
        );
        fields.insert(
            "webkitLargestAgeSeconds".to_string(),
            serde_json::json!(sample.webkit_largest_age_seconds),
        );
        fields.insert(
            "webkitLargestRole".to_string(),
            serde_json::json!(sample.webkit_largest_role),
        );
        fields.insert(
            "webkitProcessCount".to_string(),
            serde_json::json!(sample.webkit_process_count),
        );
        fields.insert(
            "webkitTelemetryAvailable".to_string(),
            serde_json::json!(sample.webkit_telemetry_available),
        );
        fields.insert(
            "memoryHighBytes".to_string(),
            serde_json::json!(sample.memory_high_bytes),
        );
        fields.insert(
            "memoryCriticalBytes".to_string(),
            serde_json::json!(sample.memory_critical_bytes),
        );
    }

    fields
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
            last_hidden_timer_throttled: None,
            last_dom_node_count: None,
            last_renderer_heap_used_bytes: None,
            last_renderer_heap_total_bytes: None,
            last_input_age_ms: None,
            last_settings_open: None,
            last_dialog_open: None,
            stale_logged: false,
            throttle_logged: false,
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
        self.last_hidden_timer_throttled = payload.hidden_timer_throttled;
        self.last_dom_node_count = payload.dom_node_count;
        self.last_renderer_heap_used_bytes = payload.renderer_heap_used_bytes;
        self.last_renderer_heap_total_bytes = payload.renderer_heap_total_bytes;
        self.last_input_age_ms = payload.last_input_age_ms;
        self.last_settings_open = payload.settings_open;
        self.last_dialog_open = payload.dialog_open;
        self.stale_logged = false;
        self.throttle_logged = false;
        self.recovery_attempts = 0;

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
        self.last_hidden_timer_throttled = None;
        self.last_dom_node_count = None;
        self.last_renderer_heap_used_bytes = None;
        self.last_renderer_heap_total_bytes = None;
        self.last_input_age_ms = None;
        self.last_settings_open = None;
        self.last_dialog_open = None;
        self.stale_logged = false;
        self.throttle_logged = false;
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
    is_visible && last_visibility != "hidden"
}

fn renderer_watchdog_treats_as_visible(
    is_visible: bool,
    is_focused: bool,
    last_visibility: &str,
) -> bool {
    renderer_is_effectively_visible(
        is_visible,
        renderer_watchdog_last_visibility_for_policy(is_visible, is_focused, last_visibility),
    )
}

fn renderer_watchdog_last_visibility_for_policy<'a>(
    is_visible: bool,
    is_focused: bool,
    last_visibility: &'a str,
) -> &'a str {
    if is_visible && is_focused && last_visibility == "hidden" {
        "visible"
    } else {
        last_visibility
    }
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

fn renderer_gap_is_expected_hidden_throttle(
    is_visible: bool,
    last_visibility: &str,
    last_hidden_timer_throttled: Option<bool>,
    age: Duration,
    _recovery_threshold: Duration,
) -> bool {
    !renderer_is_effectively_visible(is_visible, last_visibility)
        && (last_visibility == "hidden" || last_hidden_timer_throttled == Some(true))
        && age >= WEBKIT_HIDDEN_TIMER_THROTTLE_AFTER
}

fn renderer_health_hidden_timer_throttled(
    expected_hidden_throttle: bool,
    last_hidden_timer_throttled: Option<bool>,
) -> Option<bool> {
    if expected_hidden_throttle {
        Some(true)
    } else {
        last_hidden_timer_throttled
    }
}

fn renderer_stale_should_recover(is_visible: bool, last_visibility: &str) -> bool {
    renderer_is_effectively_visible(is_visible, last_visibility)
}

fn renderer_event_loop_lag_should_recover(
    is_visible: bool,
    last_visibility: &str,
    event_loop_lag_ms: Option<f64>,
) -> bool {
    renderer_is_effectively_visible(is_visible, last_visibility)
        && event_loop_lag_ms
            .map(|lag| lag >= RENDERER_EVENT_LOOP_LAG_RECOVERY_MS)
            .unwrap_or(false)
}

#[cfg(test)]
fn main_renderer_memory_should_recover(
    is_visible: bool,
    last_visibility: &str,
    stats: &RuntimeMemoryStats,
) -> bool {
    main_renderer_memory_recovery_reason(is_visible, last_visibility, stats).is_some()
}

fn main_renderer_memory_recovery_reason(
    is_visible: bool,
    last_visibility: &str,
    stats: &RuntimeMemoryStats,
) -> Option<&'static str> {
    let effectively_visible = renderer_is_effectively_visible(is_visible, last_visibility);
    if stats.webkit_largest_role.as_deref() != Some("freed-webcontent-age-matched") {
        return None;
    }
    if !stats
        .webkit_largest_age_seconds
        .map(|age| age >= MAIN_RENDERER_MEMORY_RECOVERY_MIN_AGE_SECONDS)
        .unwrap_or(false)
    {
        return None;
    }

    let main_webkit_pressure_bytes = stats
        .webkit_largest_footprint_bytes
        .unwrap_or_else(|| stats.webkit_largest_resident_bytes.unwrap_or(0));
    if main_webkit_pressure_bytes >= stats.memory_high_bytes {
        return Some(if effectively_visible {
            "webkit_footprint_pressure"
        } else {
            "idle_webkit_footprint_pressure"
        });
    }

    if webkit_resident_tail_is_probably_reclaimable(stats)
        && stats.webkit_largest_resident_bytes.unwrap_or(0)
            >= POST_SOCIAL_SCRAPE_WEBKIT_RESIDENT_RECOVERY_BYTES
        && stats.app_resident_bytes >= POST_SOCIAL_SCRAPE_WEBKIT_RESIDENT_RECOVERY_BYTES
    {
        return Some(if effectively_visible {
            "webkit_resident_tail"
        } else {
            "idle_webkit_resident_tail"
        });
    }

    None
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
            renderer_recovery_threshold(false, "hidden"),
            RENDERER_HIDDEN_RECOVERY_AFTER
        );
        assert_eq!(
            renderer_recovery_threshold(false, "visible"),
            RENDERER_HIDDEN_RECOVERY_AFTER
        );
        assert_eq!(
            renderer_recovery_threshold(true, "visible"),
            RENDERER_VISIBLE_RECOVERY_AFTER
        );
    }

    #[test]
    fn focused_native_window_promotes_stale_hidden_renderer_to_foreground() {
        let policy_last_visibility =
            renderer_watchdog_last_visibility_for_policy(true, true, "hidden");
        assert_eq!(policy_last_visibility, "visible");
        assert!(renderer_watchdog_treats_as_visible(true, true, "hidden"));
        assert!(renderer_stale_should_recover(true, policy_last_visibility));
        assert_eq!(
            renderer_recovery_threshold_for_count(true, policy_last_visibility, 0),
            RENDERER_VISIBLE_RECOVERY_AFTER
        );
        assert!(!renderer_gap_is_expected_hidden_throttle(
            true,
            policy_last_visibility,
            Some(true),
            RENDERER_VISIBLE_RECOVERY_AFTER + Duration::from_secs(1),
            RENDERER_VISIBLE_RECOVERY_AFTER,
        ));
    }

    #[test]
    fn unfocused_native_window_keeps_hidden_renderer_throttle_classification() {
        let policy_last_visibility =
            renderer_watchdog_last_visibility_for_policy(true, false, "hidden");
        assert_eq!(policy_last_visibility, "hidden");
        assert!(!renderer_watchdog_treats_as_visible(true, false, "hidden"));
        assert!(!renderer_stale_should_recover(true, policy_last_visibility));
        assert_eq!(
            renderer_recovery_threshold_for_count(true, policy_last_visibility, 0),
            RENDERER_HIDDEN_RECOVERY_AFTER
        );
        assert!(renderer_gap_is_expected_hidden_throttle(
            true,
            policy_last_visibility,
            Some(true),
            WEBKIT_HIDDEN_TIMER_THROTTLE_AFTER + Duration::from_secs(1),
            RENDERER_HIDDEN_RECOVERY_AFTER,
        ));
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
        assert!(RENDERER_HIDDEN_STALE_LOG_AFTER > WEBKIT_HIDDEN_TIMER_THROTTLE_AFTER);
        assert!(RENDERER_HIDDEN_STALE_LOG_AFTER < RENDERER_HIDDEN_RECOVERY_AFTER);
    }

    #[test]
    fn truly_hidden_renderer_stale_log_keeps_background_work_eligible() {
        assert!(renderer_stale_log_should_pause_background(true, "visible"));
        assert!(!renderer_stale_log_should_pause_background(true, "hidden"));
        assert!(!renderer_stale_log_should_pause_background(
            false, "visible"
        ));
        assert!(!renderer_stale_log_should_pause_background(false, "hidden"));
    }

    #[test]
    fn truly_hidden_renderer_stale_log_skips_deep_diagnostics() {
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
    fn truly_hidden_renderer_stale_skips_renderer_recovery() {
        assert!(renderer_stale_should_recover(true, "visible"));
        assert!(!renderer_stale_should_recover(true, "hidden"));
        assert!(!renderer_stale_should_recover(false, "visible"));
        assert!(!renderer_stale_should_recover(false, "hidden"));
    }

    #[test]
    fn visible_renderer_recovers_from_high_event_loop_lag() {
        assert!(renderer_event_loop_lag_should_recover(
            true,
            "visible",
            Some(RENDERER_EVENT_LOOP_LAG_RECOVERY_MS)
        ));
        assert!(!renderer_event_loop_lag_should_recover(
            true,
            "visible",
            Some(RENDERER_EVENT_LOOP_LAG_RECOVERY_MS - 1.0)
        ));
        assert!(!renderer_event_loop_lag_should_recover(
            true,
            "visible",
            Some(5_500.0)
        ));
        assert!(!renderer_event_loop_lag_should_recover(
            true,
            "hidden",
            Some(RENDERER_EVENT_LOOP_LAG_RECOVERY_MS)
        ));
        assert!(!renderer_event_loop_lag_should_recover(
            false,
            "visible",
            Some(RENDERER_EVENT_LOOP_LAG_RECOVERY_MS)
        ));
    }

    #[test]
    fn visible_main_renderer_recovers_from_high_webkit_footprint() {
        let stats = RuntimeMemoryStats {
            total_physical_memory_bytes: 16 * BYTES_PER_GIB,
            process_resident_bytes: 128,
            process_footprint_bytes: Some(128),
            process_virtual_bytes: 256,
            app_resident_bytes: 9 * BYTES_PER_GIB,
            app_memory_pressure_bytes: 7 * BYTES_PER_GIB,
            webkit_resident_bytes: Some(8 * BYTES_PER_GIB),
            webkit_footprint_bytes: Some(7 * BYTES_PER_GIB),
            webkit_virtual_bytes: None,
            webkit_process_id: Some(123),
            webkit_total_resident_bytes: 8 * BYTES_PER_GIB,
            webkit_total_footprint_bytes: Some(7 * BYTES_PER_GIB),
            webkit_process_count: 1,
            webkit_largest_resident_bytes: Some(8 * BYTES_PER_GIB),
            webkit_largest_footprint_bytes: Some(7 * BYTES_PER_GIB),
            webkit_largest_process_id: Some(123),
            webkit_largest_cpu_usage: Some(0.0),
            webkit_largest_age_seconds: Some(MAIN_RENDERER_MEMORY_RECOVERY_MIN_AGE_SECONDS),
            webkit_largest_role: Some("freed-webcontent-age-matched".to_string()),
            webkit_processes: Vec::new(),
            webkit_telemetry_available: true,
            webkit_attribution_precise: true,
            indexed_db_bytes: None,
            webkit_cache_bytes: None,
            storage_sizes_sampled: true,
            sample_duration_ms: 0,
            memory_high_bytes: MIN_CRITICAL_MEMORY_BYTES * 70 / 100,
            memory_critical_bytes: MIN_CRITICAL_MEMORY_BYTES,
            relay_doc_bytes: 0,
            relay_client_count: 0,
        };

        assert!(main_renderer_memory_should_recover(true, "visible", &stats));
        assert_eq!(
            main_renderer_memory_recovery_reason(true, "visible", &stats),
            Some("webkit_footprint_pressure")
        );
        assert_eq!(
            main_renderer_memory_recovery_reason(true, "hidden", &stats),
            Some("idle_webkit_footprint_pressure")
        );
        assert!(main_renderer_memory_should_recover(true, "hidden", &stats));
        assert!(!main_renderer_memory_should_recover(
            true,
            "visible",
            &RuntimeMemoryStats {
                webkit_largest_role: Some("ig-scraper".to_string()),
                ..stats.clone()
            }
        ));
        assert!(!main_renderer_memory_should_recover(
            true,
            "visible",
            &RuntimeMemoryStats {
                webkit_largest_age_seconds: Some(MAIN_RENDERER_MEMORY_RECOVERY_MIN_AGE_SECONDS - 1,),
                ..stats
            }
        ));
    }

    #[test]
    fn visible_main_renderer_recovers_from_reclaimable_webkit_resident_tail() {
        let stats = RuntimeMemoryStats {
            total_physical_memory_bytes: 16 * BYTES_PER_GIB,
            process_resident_bytes: 128,
            process_footprint_bytes: Some(128),
            process_virtual_bytes: 256,
            app_resident_bytes: 6 * BYTES_PER_GIB,
            app_memory_pressure_bytes: 2 * BYTES_PER_GIB,
            webkit_resident_bytes: Some(5 * BYTES_PER_GIB),
            webkit_footprint_bytes: Some(BYTES_PER_GIB),
            webkit_virtual_bytes: None,
            webkit_process_id: Some(123),
            webkit_total_resident_bytes: 5 * BYTES_PER_GIB,
            webkit_total_footprint_bytes: Some(BYTES_PER_GIB),
            webkit_process_count: 1,
            webkit_largest_resident_bytes: Some(5 * BYTES_PER_GIB),
            webkit_largest_footprint_bytes: Some(BYTES_PER_GIB),
            webkit_largest_process_id: Some(123),
            webkit_largest_cpu_usage: Some(0.0),
            webkit_largest_age_seconds: Some(MAIN_RENDERER_MEMORY_RECOVERY_MIN_AGE_SECONDS),
            webkit_largest_role: Some("freed-webcontent-age-matched".to_string()),
            webkit_processes: Vec::new(),
            webkit_telemetry_available: true,
            webkit_attribution_precise: true,
            indexed_db_bytes: None,
            webkit_cache_bytes: None,
            storage_sizes_sampled: true,
            sample_duration_ms: 0,
            memory_high_bytes: 9 * BYTES_PER_GIB,
            memory_critical_bytes: 12 * BYTES_PER_GIB,
            relay_doc_bytes: 0,
            relay_client_count: 0,
        };

        assert!(webkit_resident_tail_is_probably_reclaimable(&stats));
        assert_eq!(
            main_renderer_memory_recovery_reason(true, "visible", &stats),
            Some("webkit_resident_tail")
        );
        assert!(main_renderer_memory_should_recover(true, "visible", &stats));
        assert_eq!(
            main_renderer_memory_recovery_reason(true, "hidden", &stats),
            Some("idle_webkit_resident_tail")
        );
        assert!(main_renderer_memory_should_recover(true, "hidden", &stats));
    }

    #[test]
    fn hidden_timer_throttle_gap_is_not_a_stale_renderer() {
        assert!(renderer_gap_is_expected_hidden_throttle(
            false,
            "hidden",
            Some(true),
            RENDERER_HIDDEN_STALE_LOG_AFTER + Duration::from_secs(1),
            RENDERER_HIDDEN_RECOVERY_AFTER,
        ));
        assert!(renderer_gap_is_expected_hidden_throttle(
            true,
            "hidden",
            Some(false),
            RENDERER_HIDDEN_STALE_LOG_AFTER + Duration::from_secs(1),
            RENDERER_HIDDEN_RECOVERY_AFTER,
        ));
        assert!(!renderer_gap_is_expected_hidden_throttle(
            true,
            "visible",
            Some(true),
            RENDERER_HIDDEN_STALE_LOG_AFTER + Duration::from_secs(1),
            RENDERER_HIDDEN_RECOVERY_AFTER,
        ));
        assert!(renderer_gap_is_expected_hidden_throttle(
            false,
            "hidden",
            Some(false),
            RENDERER_HIDDEN_STALE_LOG_AFTER + Duration::from_secs(1),
            RENDERER_HIDDEN_RECOVERY_AFTER,
        ));
        assert!(!renderer_gap_is_expected_hidden_throttle(
            false,
            "hidden",
            Some(true),
            WEBKIT_HIDDEN_TIMER_THROTTLE_AFTER - Duration::from_secs(1),
            RENDERER_HIDDEN_RECOVERY_AFTER,
        ));
        assert!(renderer_gap_is_expected_hidden_throttle(
            false,
            "hidden",
            Some(true),
            RENDERER_HIDDEN_RECOVERY_AFTER + Duration::from_secs(1),
            RENDERER_HIDDEN_RECOVERY_AFTER,
        ));
    }

    #[test]
    fn heartbeat_after_hidden_timer_throttle_does_not_report_recovered() {
        let mut status = RendererHeartbeatStatus::new();
        status.throttle_logged = true;

        let payload = RendererHeartbeatPayload {
            seq: 8,
            ts: 1_777_000_000_000,
            reason: "interval".to_string(),
            visibility: "hidden".to_string(),
            href: "tauri://localhost".to_string(),
            page_load_id: Some("page-1".to_string()),
            uptime_ms: Some(600_000),
            app_phase: Some("ready".to_string()),
            event_loop_lag_ms: None,
            hidden_timer_throttled: Some(true),
            dom_node_count: Some(100),
            renderer_heap_used_bytes: Some(1024),
            renderer_heap_total_bytes: Some(2048),
            last_input_age_ms: Some(600_000),
            settings_open: Some(false),
            dialog_open: Some(false),
        };
        let (_first_heartbeat, _gap_ms, recovered) =
            status.note_heartbeat(&payload, std::time::Instant::now());

        assert!(!recovered);
        assert!(!status.throttle_logged);
        assert_eq!(status.last_hidden_timer_throttled, Some(true));
    }

    #[test]
    fn native_hidden_timer_classification_is_reported_in_health_payloads() {
        assert_eq!(
            renderer_health_hidden_timer_throttled(true, Some(false)),
            Some(true)
        );
        assert_eq!(
            renderer_health_hidden_timer_throttled(false, Some(false)),
            Some(false)
        );
        assert_eq!(renderer_health_hidden_timer_throttled(false, None), None);
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
            hidden_timer_throttled: Some(false),
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
        assert!(status.last_recovery_at.is_some());
        assert_eq!(status.last_seq, 7);
        assert_eq!(status.last_page_load_id.as_deref(), Some("page-1"));
        assert_eq!(status.last_hidden_timer_throttled, Some(false));
    }

    #[test]
    fn heartbeat_after_recovery_keeps_recovery_cooldown() {
        let mut status = RendererHeartbeatStatus::new();
        let recovery_at = std::time::Instant::now();
        status.note_recovery_attempt(recovery_at);

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
            hidden_timer_throttled: Some(false),
            dom_node_count: Some(100),
            renderer_heap_used_bytes: Some(1024),
            renderer_heap_total_bytes: Some(2048),
            last_input_age_ms: Some(50),
            settings_open: Some(false),
            dialog_open: Some(false),
        };

        let (_first_heartbeat, _gap_ms, recovered) =
            status.note_heartbeat(&payload, recovery_at + Duration::from_secs(1));

        assert!(recovered);
        assert_eq!(status.last_recovery_at, Some(recovery_at));
        assert_eq!(
            renderer_recovery_threshold_for_count(
                true,
                "visible",
                status.recent_recovery_count(BACKGROUND_SAFE_MODE_RECOVERY_WINDOW_SHORT)
            ),
            RENDERER_VISIBLE_RECOVERY_AFTER
        );
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
async fn fetch_url(url: String, max_bytes: Option<usize>) -> Result<String, String> {
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

    let Some(limit) = max_bytes else {
        return response.text().await.map_err(|e| e.to_string());
    };

    if let Some(content_length) = response.content_length() {
        if content_length > limit as u64 {
            return Err(format!(
                "response_too_large content_length={} limit={} url={}",
                content_length, limit, url
            ));
        }
    }

    let mut body: Vec<u8> = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        if body.len().saturating_add(chunk.len()) > limit {
            return Err(format!(
                "response_too_large bytes_exceeded limit={} url={}",
                limit, url
            ));
        }
        body.extend_from_slice(&chunk);
    }

    Ok(String::from_utf8_lossy(&body).into_owned())
}

#[derive(serde::Serialize)]
struct NativeHttpResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

fn response_headers(response: &reqwest::Response) -> Vec<(String, String)> {
    response
        .headers()
        .iter()
        .filter_map(|(key, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (key.as_str().to_string(), value.to_string()))
        })
        .collect()
}

/// Fetch a Google People API URL with a bearer token.
#[tauri::command]
async fn google_api_request(
    url: String,
    access_token: String,
) -> Result<NativeHttpResponse, String> {
    let parsed = url::Url::parse(&url).map_err(|e| format!("Invalid Google API URL: {}", e))?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("people.googleapis.com") {
        return Err("Google API URL is not allowed".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("Freed/1.0 (https://freed.wtf)")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(parsed).bearer_auth(access_token).send().await;

    let response = match response {
        Ok(response) => response,
        Err(error) => {
            warn!("[google/contacts] request failed: {}", error);
            return Err(format!("Google Contacts request failed: {}", error));
        }
    };

    let status = response.status().as_u16();
    let headers = response_headers(&response);
    let body = response.bytes().await.map_err(|e| e.to_string())?.to_vec();
    if status >= 400 {
        let body_preview = String::from_utf8_lossy(&body);
        warn!(
            "[google/contacts] People API returned status={} body={}",
            status,
            body_preview.chars().take(512).collect::<String>()
        );
    } else {
        info!("[google/contacts] People API returned status={}", status);
    }

    Ok(NativeHttpResponse {
        status,
        headers,
        body,
    })
}

/// Make a Google Drive API request through the native networking stack.
#[tauri::command]
async fn google_drive_request(
    url: String,
    method: Option<String>,
    headers: Option<Vec<(String, String)>>,
    body: Option<Vec<u8>>,
) -> Result<NativeHttpResponse, String> {
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
    let headers = response_headers(&response);
    let body = response.bytes().await.map_err(|e| e.to_string())?.to_vec();

    Ok(NativeHttpResponse {
        status,
        headers,
        body,
    })
}

/// POST to Google OAuth endpoints through native networking.
#[tauri::command]
async fn google_oauth_proxy_request(
    url: String,
    body: String,
    content_type: Option<String>,
) -> Result<NativeHttpResponse, String> {
    let parsed = url::Url::parse(&url).map_err(|e| format!("Invalid Google OAuth URL: {}", e))?;
    let host = parsed.host_str().unwrap_or_default();
    let allowed_proxy = (host == "app.freed.wtf" || host == "localhost" || host == "127.0.0.1")
        && parsed.path() == "/api/oauth/google";
    let allowed_google = host == "oauth2.googleapis.com" && parsed.path() == "/token";
    if parsed.scheme() != "https" && host != "localhost" && host != "127.0.0.1" {
        return Err("Google OAuth URL must use HTTPS".to_string());
    }
    if !allowed_proxy && !allowed_google {
        return Err("Google OAuth URL is not allowed".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("Freed/1.0 (https://freed.wtf)")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post(parsed)
        .header(
            "Content-Type",
            content_type.unwrap_or_else(|| "application/json".to_string()),
        )
        .body(body)
        .send()
        .await;

    let response = match response {
        Ok(response) => response,
        Err(error) => {
            warn!("[google/oauth] request failed: {}", error);
            return Err(format!("Google OAuth request failed: {}", error));
        }
    };

    let status = response.status().as_u16();
    let headers = response_headers(&response);
    let body = response.bytes().await.map_err(|e| e.to_string())?.to_vec();
    if status >= 400 {
        let body_preview = String::from_utf8_lossy(&body);
        warn!(
            "[google/oauth] request returned status={} body={}",
            status,
            body_preview.chars().take(512).collect::<String>()
        );
    } else {
        info!("[google/oauth] request returned status={}", status);
    }

    Ok(NativeHttpResponse {
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

fn social_feed_scroll_script(delta_px: i64) -> String {
    const SCRIPT_TEMPLATE: &str = r#"
        (function() {
            var requestedDelta = Number(__FREED_SCROLL_DELTA__) || 0;
            var direction = requestedDelta >= 0 ? 1 : -1;
            var minimumUsefulMovement = Math.max(18, Math.min(64, Math.abs(requestedDelta) * 0.18));

            function clamp(value, min, max) {
                return Math.max(min, Math.min(max, value));
            }

            function isElement(value) {
                return value && value.nodeType === 1;
            }

            function scrollTopOf(target) {
                if (target === window) {
                    return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
                }
                return target.scrollTop || 0;
            }

            function maxScrollTop(target) {
                if (target === window) {
                    var doc = document.scrollingElement || document.documentElement || document.body;
                    return Math.max(0, doc.scrollHeight - window.innerHeight);
                }
                return Math.max(0, target.scrollHeight - target.clientHeight);
            }

            function writeScrollTop(target, value) {
                if (target === window) {
                    window.scrollTo({ top: value, left: window.scrollX || 0, behavior: "auto" });
                    return;
                }
                if (typeof target.scrollTo === "function") {
                    target.scrollTo({ top: value, left: target.scrollLeft || 0, behavior: "auto" });
                    return;
                }
                target.scrollTop = value;
            }

            function canScroll(target) {
                if (!target) return false;
                var max = maxScrollTop(target);
                if (max < 80) return false;
                var top = scrollTopOf(target);
                return direction > 0 ? top < max - 2 : top > 2;
            }

            function addCandidate(list, seen, target) {
                if (!target || seen.indexOf(target) >= 0) return;
                if (target !== window && !isElement(target)) return;
                seen.push(target);
                list.push(target);
            }

            function addAncestorCandidates(list, seen, node) {
                var current = isElement(node) ? node : null;
                var depth = 0;
                while (current && depth < 8) {
                    addCandidate(list, seen, current);
                    current = current.parentElement;
                    depth += 1;
                }
            }

            function targetLabel(target) {
                if (target === window) return "window";
                if (target === document.scrollingElement) return "document.scrollingElement";
                if (target === document.documentElement) return "document.documentElement";
                if (target === document.body) return "document.body";
                if (!isElement(target)) return "unknown";
                var label = (target.tagName || "element").toLowerCase();
                var role = target.getAttribute("role");
                var aria = target.getAttribute("aria-label");
                var testId = target.getAttribute("data-testid");
                if (role) label += "[role='" + role + "']";
                if (testId) label += "[data-testid='" + testId.slice(0, 40) + "']";
                if (aria) label += "[aria-label='" + aria.slice(0, 40) + "']";
                return label;
            }

            function isVisibleScrollableElement(target) {
                if (!isElement(target)) return false;
                if (maxScrollTop(target) < 80) return false;
                try {
                    var style = window.getComputedStyle(target);
                    if (!/(auto|scroll|overlay)/.test(style.overflowY || style.overflow || "")) return false;
                    if (style.display === "none" || style.visibility === "hidden") return false;
                    var rect = target.getBoundingClientRect();
                    if (rect.width < 120 || rect.height < 120) return false;
                    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
                } catch (_) {
                    return false;
                }
                return true;
            }

            function addVisibleScrollableCandidates(list, seen) {
                var nodes = [];
                try {
                    nodes = Array.prototype.slice.call(document.querySelectorAll("main, [role='main'], [role='feed'], div, section, ul")).slice(0, 1800);
                } catch (_) {}
                nodes.forEach(function(node) {
                    if (isVisibleScrollableElement(node)) addCandidate(list, seen, node);
                });
            }

            function candidateScore(target) {
                var range = maxScrollTop(target);
                if (target === window || target === document.scrollingElement) return range + 100000;
                try {
                    var rect = target.getBoundingClientRect();
                    var visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
                    return range + visibleHeight * 4;
                } catch (_) {
                    return range;
                }
            }

            function selectScrollers() {
                var candidates = [];
                var seen = [];
                addCandidate(candidates, seen, document.scrollingElement || document.documentElement || document.body);
                addCandidate(candidates, seen, document.documentElement);
                addCandidate(candidates, seen, document.body);
                addCandidate(candidates, seen, window);

                var anchors = [];
                try {
                    anchors = Array.prototype.slice.call(document.querySelectorAll([
                        "main",
                        "[role='main']",
                        "[role='feed']",
                        "[aria-label*='feed' i]",
                        "[data-pagelet*='Feed']",
                        "[data-pagelet*='feed']"
                    ].join(","))).slice(0, 12);
                } catch (_) {}

                anchors.forEach(function(anchor) {
                    addAncestorCandidates(candidates, seen, anchor);
                });

                addVisibleScrollableCandidates(candidates, seen);

                return candidates
                    .filter(canScroll)
                    .sort(function(a, b) { return candidateScore(b) - candidateScore(a); })
                    .slice(0, 6);
            }

            function humanStep(target, remainingSteps, done) {
                var current = scrollTopOf(target);
                var max = maxScrollTop(target);
                var targetTop = clamp(current + requestedDelta, 0, max);
                var remaining = targetTop - current;
                if (remainingSteps <= 1 || Math.abs(remaining) < 2) {
                    writeScrollTop(target, targetTop);
                    done();
                    return;
                }

                var unevenness = 0.62 + Math.random() * 0.76;
                var step = remaining / remainingSteps * unevenness;
                var minStep = Math.min(22, Math.max(6, Math.abs(remaining) / (remainingSteps * 3)));
                if (Math.abs(step) < minStep) step = minStep * (step < 0 ? -1 : 1);
                if (Math.abs(step) > Math.abs(remaining)) step = remaining;

                writeScrollTop(target, clamp(current + step, 0, max));
                setTimeout(function() {
                    humanStep(target, remainingSteps - 1, done);
                }, 42 + Math.floor(Math.random() * 88));
            }

            function tryScrollAt(index, scrollers) {
                if (index >= scrollers.length) return;

                var target = scrollers[index];
                var before = scrollTopOf(target);
                var steps = 5 + Math.floor(Math.random() * 7);
                humanStep(target, steps, function() {
                    setTimeout(function() {
                        var after = scrollTopOf(target);
                        var movement = Math.abs(after - before);
                        if (movement >= minimumUsefulMovement) {
                            window.__FREED_LAST_SOCIAL_SCROLL__ = {
                                target: targetLabel(target),
                                before: before,
                                after: after,
                                movement: movement,
                                requestedDelta: requestedDelta,
                                candidateCount: scrollers.length,
                                at: Date.now()
                            };
                            return;
                        }

                        if (index + 1 < scrollers.length) {
                            tryScrollAt(index + 1, scrollers);
                            return;
                        }

                        try {
                            writeScrollTop(target, clamp(after + requestedDelta, 0, maxScrollTop(target)));
                            window.__FREED_LAST_SOCIAL_SCROLL__ = {
                                target: targetLabel(target),
                                before: before,
                                after: scrollTopOf(target),
                                movement: Math.abs(scrollTopOf(target) - before),
                                requestedDelta: requestedDelta,
                                candidateCount: scrollers.length,
                                fallback: true,
                                at: Date.now()
                            };
                        } catch (_) {}
                    }, 180 + Math.floor(Math.random() * 180));
                });
            }

            var scrollers = selectScrollers();
            window.__FREED_LAST_SOCIAL_SCROLL__ = {
                target: "none",
                before: 0,
                after: 0,
                movement: 0,
                requestedDelta: requestedDelta,
                candidateCount: scrollers.length,
                at: Date.now()
            };
            if (scrollers.length > 0) {
                tryScrollAt(0, scrollers);
            } else {
                try {
                    window.scrollBy({ top: requestedDelta, left: 0, behavior: "auto" });
                    window.__FREED_LAST_SOCIAL_SCROLL__ = {
                        target: "window.scrollBy",
                        before: 0,
                        after: window.scrollY || 0,
                        movement: 0,
                        requestedDelta: requestedDelta,
                        candidateCount: 0,
                        fallback: true,
                        at: Date.now()
                    };
                } catch (_) {}
            }
        })();
    "#;

    SCRIPT_TEMPLATE.replace("__FREED_SCROLL_DELTA__", &delta_px.to_string())
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

fn webkit_process_started_after_app_start(webkit_age_seconds: u64, app_age_seconds: u64) -> bool {
    webkit_age_seconds <= app_age_seconds.saturating_add(WEBKIT_PROCESS_START_GRACE_SECONDS)
}

fn webkit_process_started_with_app(webkit_age_seconds: u64, app_age_seconds: u64) -> bool {
    webkit_age_seconds.abs_diff(app_age_seconds) <= WEBKIT_PROCESS_START_GRACE_SECONDS
}

fn freed_webkit_process_role(
    has_open_file_under_roots: bool,
    webkit_age_seconds: u64,
    app_age_seconds: u64,
) -> Option<&'static str> {
    if has_open_file_under_roots {
        if webkit_process_started_after_app_start(webkit_age_seconds, app_age_seconds) {
            Some("freed-webcontent")
        } else {
            None
        }
    } else if webkit_process_started_with_app(webkit_age_seconds, app_age_seconds) {
        Some("freed-webcontent-age-matched")
    } else {
        None
    }
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
    precise_attribution: bool,
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
            let age_seconds = process.run_time();
            let has_open_file_under_roots =
                precise_attribution && macos_process_has_open_file_under_roots(pid_u32, roots);
            let Some(role) =
                freed_webkit_process_role(has_open_file_under_roots, age_seconds, app_age_seconds)
            else {
                continue;
            };
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
                role: role.to_string(),
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
    collect_runtime_memory_stats_with_options(
        app,
        relay_doc_bytes,
        relay_client_count,
        RuntimeMemoryStatsOptions::full(),
    )
}

fn collect_runtime_memory_stats_with_options(
    app: &tauri::AppHandle,
    relay_doc_bytes: u64,
    relay_client_count: u64,
    options: RuntimeMemoryStatsOptions,
) -> RuntimeMemoryStats {
    let sample_started_at = Instant::now();
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

    let webkit = freed_webkit_memory_stats(
        &system,
        &app_storage_roots(app),
        process_age_seconds,
        options.precise_webkit_attribution,
    );
    let total_physical_memory_bytes = system.total_memory();
    let (memory_high_bytes, memory_critical_bytes) =
        memory_pressure_limits(total_physical_memory_bytes);
    let indexed_db_bytes = options
        .include_storage_sizes
        .then(|| {
            app.path()
                .app_data_dir()
                .ok()
                .and_then(|path| dir_size_bytes(&path.join("IndexedDB")))
        })
        .flatten();
    let webkit_cache_bytes = options
        .include_storage_sizes
        .then(|| {
            app.path()
                .app_cache_dir()
                .ok()
                .and_then(|path| dir_size_bytes(&path.join("WebKit")))
        })
        .flatten();
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
        webkit_attribution_precise: options.precise_webkit_attribution,
        indexed_db_bytes,
        webkit_cache_bytes,
        storage_sizes_sampled: options.include_storage_sizes,
        sample_duration_ms: sample_started_at
            .elapsed()
            .as_millis()
            .min(u128::from(u64::MAX)) as u64,
        memory_high_bytes,
        memory_critical_bytes,
        relay_doc_bytes,
        relay_client_count,
    }
}

fn webkit_resident_delta_bytes(before: u64, after: u64) -> i64 {
    if before >= after {
        before.saturating_sub(after).min(i64::MAX as u64) as i64
    } else {
        -(after.saturating_sub(before).min(i64::MAX as u64) as i64)
    }
}

fn scraper_recycle_verification_from_processes(
    before_processes: &[WebkitProcessRuntimeStats],
    before_webkit_resident_bytes: u64,
    after_processes: &[WebkitProcessRuntimeStats],
    after_webkit_resident_bytes: u64,
    elapsed_ms: u128,
) -> ScraperRecycleVerification {
    let before_process_ids: Vec<u32> = before_processes
        .iter()
        .map(|process| process.process_id)
        .collect();
    let after_process_ids: Vec<u32> = after_processes
        .iter()
        .map(|process| process.process_id)
        .collect();
    let after_set: HashSet<u32> = after_process_ids.iter().copied().collect();
    let before_set: HashSet<u32> = before_process_ids.iter().copied().collect();
    let exited_process_ids: Vec<u32> = before_process_ids
        .iter()
        .copied()
        .filter(|process_id| !after_set.contains(process_id))
        .collect();
    let retained_process_ids: Vec<u32> = before_process_ids
        .iter()
        .copied()
        .filter(|process_id| after_set.contains(process_id))
        .collect();
    let new_process_ids: Vec<u32> = after_process_ids
        .iter()
        .copied()
        .filter(|process_id| !before_set.contains(process_id))
        .collect();

    ScraperRecycleVerification {
        elapsed_ms: elapsed_ms.min(u64::MAX as u128) as u64,
        before_process_ids,
        after_process_ids,
        exited_process_ids,
        retained_process_ids,
        new_process_ids,
        before_webkit_resident_bytes,
        after_webkit_resident_bytes,
        webkit_resident_delta_bytes: webkit_resident_delta_bytes(
            before_webkit_resident_bytes,
            after_webkit_resident_bytes,
        ),
    }
}

fn build_scraper_recycle_verification(
    recycled_scraper_windows: bool,
    before: &RuntimeMemoryStats,
    after: &RuntimeMemoryStats,
    elapsed_ms: u128,
) -> Option<ScraperRecycleVerification> {
    recycled_scraper_windows.then(|| {
        scraper_recycle_verification_from_processes(
            &before.webkit_processes,
            before.webkit_total_resident_bytes,
            &after.webkit_processes,
            after.webkit_total_resident_bytes,
            elapsed_ms,
        )
    })
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

fn scrape_resident_start_budget_bytes(stats: &RuntimeMemoryStats) -> u64 {
    stats
        .memory_high_bytes
        .min(stats.memory_critical_bytes)
        .saturating_sub(SCRAPE_MEMORY_HEADROOM_BYTES)
}

fn webkit_resident_tail_is_probably_reclaimable(stats: &RuntimeMemoryStats) -> bool {
    if !stats.webkit_telemetry_available {
        return false;
    }
    let Some(webkit_footprint_bytes) = stats.webkit_total_footprint_bytes else {
        return false;
    };
    if stats.webkit_total_resident_bytes <= webkit_footprint_bytes {
        return false;
    }
    let webkit_resident_tail_bytes = stats.webkit_total_resident_bytes - webkit_footprint_bytes;
    let largest_webkit_cpu_usage = stats.webkit_largest_cpu_usage.unwrap_or(0.0);
    stats.app_memory_pressure_bytes < scrape_memory_start_budget_bytes(stats)
        && stats.app_resident_bytes
            < stats
                .memory_critical_bytes
                .saturating_sub(SCRAPE_MEMORY_HEADROOM_BYTES)
        && webkit_resident_tail_bytes >= BYTES_PER_GIB
        && largest_webkit_cpu_usage <= 10.0
}

fn scrape_effective_resident_bytes(stats: &RuntimeMemoryStats) -> u64 {
    if webkit_resident_tail_is_probably_reclaimable(stats) {
        return stats
            .process_resident_bytes
            .saturating_add(stats.webkit_total_footprint_bytes.unwrap_or(0));
    }
    stats.app_resident_bytes
}

fn scrape_memory_may_proceed(stats: &RuntimeMemoryStats) -> bool {
    stats.app_memory_pressure_bytes < scrape_memory_start_budget_bytes(stats)
        && scrape_effective_resident_bytes(stats) < scrape_resident_start_budget_bytes(stats)
}

fn scrape_memory_pressure_level(stats: &RuntimeMemoryStats) -> &'static str {
    let effective_resident_bytes = scrape_effective_resident_bytes(stats);
    if stats.app_memory_pressure_bytes >= stats.memory_critical_bytes
        || (stats.app_resident_bytes >= stats.memory_critical_bytes
            && !webkit_resident_tail_is_probably_reclaimable(stats))
    {
        "critical"
    } else if stats.app_memory_pressure_bytes >= stats.memory_high_bytes
        || effective_resident_bytes >= scrape_resident_start_budget_bytes(stats)
    {
        "high"
    } else {
        "normal"
    }
}

fn optional_story_memory_budget_bytes(stats: &RuntimeMemoryStats) -> u64 {
    stats
        .memory_high_bytes
        .saturating_mul(OPTIONAL_STORY_MEMORY_BUDGET_PERCENT)
        / 100
}

fn optional_story_scrape_may_proceed(stats: &RuntimeMemoryStats) -> bool {
    let story_budget_bytes = optional_story_memory_budget_bytes(stats);
    stats.app_memory_pressure_bytes < story_budget_bytes
        && stats.app_resident_bytes < story_budget_bytes
}

fn scrape_memory_available_margin_bytes(stats: &RuntimeMemoryStats) -> u64 {
    let pressure_margin =
        scrape_memory_start_budget_bytes(stats).saturating_sub(stats.app_memory_pressure_bytes);
    let resident_margin = scrape_resident_start_budget_bytes(stats)
        .saturating_sub(scrape_effective_resident_bytes(stats));
    pressure_margin.min(resident_margin)
}

fn capped_scrape_passes(
    default_max_passes: usize,
    target_min: usize,
    target_max: usize,
) -> (usize, usize) {
    let max_passes = default_max_passes.min(target_max).max(1);
    let min_passes = target_min.min(max_passes).max(1);
    (min_passes, max_passes)
}

fn social_scrape_plan_for_memory(
    stats: &RuntimeMemoryStats,
    default_min_passes: usize,
    default_max_passes: usize,
) -> SocialScrapePlan {
    if !scrape_memory_may_proceed(stats) {
        return SocialScrapePlan {
            min_passes: 0,
            max_passes: 0,
            skip_stories: true,
            reason: "blocked",
        };
    }

    let margin_bytes = scrape_memory_available_margin_bytes(stats);
    if margin_bytes <= SCRAPE_MINIMAL_PASS_MARGIN_BYTES {
        let (min_passes, max_passes) = capped_scrape_passes(default_max_passes, 2, 3);
        return SocialScrapePlan {
            min_passes,
            max_passes,
            skip_stories: true,
            reason: "minimal-memory-margin",
        };
    }

    if !optional_story_scrape_may_proceed(stats) {
        let (min_passes, max_passes) = capped_scrape_passes(default_max_passes, 3, 5);
        return SocialScrapePlan {
            min_passes,
            max_passes,
            skip_stories: true,
            reason: "feed-only-memory-budget",
        };
    }

    if margin_bytes <= SCRAPE_REDUCED_PASS_MARGIN_BYTES {
        let (min_passes, max_passes) = capped_scrape_passes(default_max_passes, 3, 5);
        return SocialScrapePlan {
            min_passes,
            max_passes,
            skip_stories: true,
            reason: "reduced-memory-margin",
        };
    }

    SocialScrapePlan {
        min_passes: default_min_passes,
        max_passes: default_max_passes,
        skip_stories: false,
        reason: "full",
    }
}

fn emit_social_scrape_plan(
    app: &tauri::AppHandle,
    provider: &str,
    operation: &str,
    plan: &SocialScrapePlan,
    stats: &RuntimeMemoryStats,
) {
    let margin_bytes = scrape_memory_available_margin_bytes(stats);
    info!(
        "[memory] scrape plan provider={} operation={} reason={} min_passes={} max_passes={} skip_stories={} app_pressure={} app_rss={} margin_bytes={} story_budget={} scrape_budget={} resident_budget={}",
        provider,
        operation,
        plan.reason,
        plan.min_passes,
        plan.max_passes,
        plan.skip_stories,
        stats.app_memory_pressure_bytes,
        stats.app_resident_bytes,
        margin_bytes,
        optional_story_memory_budget_bytes(stats),
        scrape_memory_start_budget_bytes(stats),
        scrape_resident_start_budget_bytes(stats)
    );
    append_runtime_health(
        app,
        serde_json::json!({
            "event": "social_scrape_plan",
            "provider": provider,
            "operation": operation,
            "reason": plan.reason,
            "minPasses": plan.min_passes,
            "maxPasses": plan.max_passes,
            "skipStories": plan.skip_stories,
            "appMemoryPressureBytes": stats.app_memory_pressure_bytes,
            "appResidentBytes": stats.app_resident_bytes,
            "memoryMarginBytes": margin_bytes,
            "storyBudgetBytes": optional_story_memory_budget_bytes(stats),
            "scrapeStartBudgetBytes": scrape_memory_start_budget_bytes(stats),
            "scrapeResidentBudgetBytes": scrape_resident_start_budget_bytes(stats),
            "memoryHighBytes": stats.memory_high_bytes,
            "memoryCriticalBytes": stats.memory_critical_bytes
        }),
    );
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
                "scrapeResidentBudgetBytes": scrape_resident_start_budget_bytes(&stats),
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
            optional_story_memory_budget_bytes(&stats),
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
                "storyBudgetBytes": optional_story_memory_budget_bytes(&stats),
                "storyResidentBudgetBytes": optional_story_memory_budget_bytes(&stats),
                "memoryHighBytes": stats.memory_high_bytes
            }),
        );
    }
    may_continue
}

fn post_social_scrape_memory_recovery_reason(
    before: &RuntimeMemoryStats,
    after: &RuntimeMemoryStats,
) -> Option<&'static str> {
    let after_webkit_footprint = after.webkit_total_footprint_bytes;
    let before_webkit_footprint = before.webkit_total_footprint_bytes.unwrap_or(0);
    let webkit_footprint_growth = after_webkit_footprint
        .unwrap_or(0)
        .saturating_sub(before_webkit_footprint);
    let pressure_recovery_bytes = after
        .memory_high_bytes
        .saturating_mul(POST_SOCIAL_SCRAPE_PRESSURE_RECOVERY_PERCENT)
        / 100;

    if after_webkit_footprint
        .map(|footprint| {
            footprint >= POST_SOCIAL_SCRAPE_WEBKIT_FOOTPRINT_RECOVERY_BYTES
                && webkit_footprint_growth >= POST_SOCIAL_SCRAPE_WEBKIT_FOOTPRINT_GROWTH_BYTES
        })
        .unwrap_or(false)
    {
        return Some("webkit_footprint_growth");
    }

    if after_webkit_footprint
        .map(|footprint| {
            footprint >= POST_SOCIAL_SCRAPE_WEBKIT_FOOTPRINT_RECOVERY_BYTES
                && after.app_memory_pressure_bytes >= pressure_recovery_bytes
        })
        .unwrap_or(false)
    {
        return Some("webkit_footprint_pressure");
    }

    if after.app_memory_pressure_bytes >= scrape_memory_start_budget_bytes(after)
        && !webkit_resident_tail_is_probably_reclaimable(after)
    {
        return Some("memory_pressure_high");
    }

    if webkit_resident_tail_is_probably_reclaimable(after)
        && after.webkit_total_resident_bytes >= POST_SOCIAL_SCRAPE_WEBKIT_RESIDENT_RECOVERY_BYTES
        && after.app_resident_bytes >= POST_SOCIAL_SCRAPE_WEBKIT_RESIDENT_RECOVERY_BYTES
    {
        return Some("webkit_resident_tail");
    }

    None
}

async fn maybe_recover_after_social_feed_scrape(
    app: &tauri::AppHandle,
    background_runtime: &BackgroundRuntimeCoordinator,
    provider: &str,
    before: &RuntimeMemoryStats,
) {
    tokio::time::sleep(Duration::from_millis(700)).await;

    let after = collect_runtime_memory_stats(app, 0, 0);
    let reason = post_social_scrape_memory_recovery_reason(before, &after);
    let before_webkit_footprint = before.webkit_total_footprint_bytes.unwrap_or(0);
    let after_webkit_footprint = after.webkit_total_footprint_bytes.unwrap_or(0);
    let webkit_footprint_growth = after_webkit_footprint.saturating_sub(before_webkit_footprint);
    let pressure_recovery_bytes = after
        .memory_high_bytes
        .saturating_mul(POST_SOCIAL_SCRAPE_PRESSURE_RECOVERY_PERCENT)
        / 100;

    append_runtime_health(
        app,
        serde_json::json!({
            "event": "post_social_scrape_memory_check",
            "provider": provider,
            "operation": "feed scrape",
            "shouldRecoverMainRenderer": reason.is_some(),
            "reason": reason,
            "beforeAppMemoryPressureBytes": before.app_memory_pressure_bytes,
            "beforeAppResidentBytes": before.app_resident_bytes,
            "beforeWebkitFootprintBytes": before.webkit_total_footprint_bytes,
            "beforeWebkitResidentBytes": before.webkit_total_resident_bytes,
            "afterAppMemoryPressureBytes": after.app_memory_pressure_bytes,
            "afterAppResidentBytes": after.app_resident_bytes,
            "afterWebkitFootprintBytes": after.webkit_total_footprint_bytes,
            "afterWebkitResidentBytes": after.webkit_total_resident_bytes,
            "webkitFootprintGrowthBytes": webkit_footprint_growth,
            "webkitLargestProcessId": after.webkit_largest_process_id,
            "webkitLargestFootprintBytes": after.webkit_largest_footprint_bytes,
            "webkitLargestResidentBytes": after.webkit_largest_resident_bytes,
            "webkitLargestRole": after.webkit_largest_role,
            "webkitTelemetryAvailable": after.webkit_telemetry_available,
            "webkitResidentTailReclaimable": webkit_resident_tail_is_probably_reclaimable(&after),
            "webkitFootprintRecoveryBytes": POST_SOCIAL_SCRAPE_WEBKIT_FOOTPRINT_RECOVERY_BYTES,
            "webkitFootprintGrowthRecoveryBytes": POST_SOCIAL_SCRAPE_WEBKIT_FOOTPRINT_GROWTH_BYTES,
            "webkitResidentRecoveryBytes": POST_SOCIAL_SCRAPE_WEBKIT_RESIDENT_RECOVERY_BYTES,
            "pressureRecoveryBytes": pressure_recovery_bytes,
            "memoryHighBytes": after.memory_high_bytes,
            "memoryCriticalBytes": after.memory_critical_bytes
        }),
    );

    let Some(reason) = reason else {
        return;
    };

    let recovery_reason = format!("{} feed scrape memory cleanup {}", provider, reason);
    info!(
        "[memory] recovering main renderer after social scrape provider={} reason={} before_webkit_footprint={} after_webkit_footprint={} growth={} after_pressure={} pressure_recovery_bytes={}",
        provider,
        reason,
        before_webkit_footprint,
        after_webkit_footprint,
        webkit_footprint_growth,
        after.app_memory_pressure_bytes,
        pressure_recovery_bytes
    );
    background_runtime.note_renderer_recovery_attempt(&recovery_reason);

    match recover_main_window(app, &recovery_reason) {
        Ok(()) => {
            tokio::time::sleep(Duration::from_millis(700)).await;
            let recovered = collect_runtime_memory_stats(app, 0, 0);
            append_runtime_health(
                app,
                serde_json::json!({
                    "event": "post_social_scrape_memory_recovered",
                    "provider": provider,
                    "operation": "feed scrape",
                    "reason": reason,
                    "recoveredAppMemoryPressureBytes": recovered.app_memory_pressure_bytes,
                    "recoveredAppResidentBytes": recovered.app_resident_bytes,
                    "recoveredWebkitFootprintBytes": recovered.webkit_total_footprint_bytes,
                    "recoveredWebkitResidentBytes": recovered.webkit_total_resident_bytes,
                    "recoveredWebkitLargestProcessId": recovered.webkit_largest_process_id,
                    "recoveredWebkitLargestFootprintBytes": recovered.webkit_largest_footprint_bytes,
                    "recoveredWebkitLargestResidentBytes": recovered.webkit_largest_resident_bytes,
                    "recoveredWebkitProcessCount": recovered.webkit_process_count
                }),
            );
        }
        Err(error) => {
            warn!(
                "[memory] post social scrape main renderer recovery failed provider={} reason={} error={}",
                provider, reason, error
            );
            append_runtime_health(
                app,
                serde_json::json!({
                    "event": "post_social_scrape_memory_recovery_failed",
                    "provider": provider,
                    "operation": "feed scrape",
                    "reason": reason,
                    "error": error
                }),
            );
        }
    }
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
    let recycle_started_at = Instant::now();
    let recycled_scraper_windows =
        recycle_social_scraper_windows_except(app, preserve_label, &reason);
    let cache_trim_result = trim_webkit_network_cache(app);
    let cache_trimmed = cache_trim_result.cache_trimmed;

    if recycled_scraper_windows || cache_trimmed {
        tokio::time::sleep(Duration::from_millis(700)).await;
    }

    let after = collect_runtime_memory_stats(app, relay_doc_bytes, relay_client_count);
    let scraper_recycle_verification = build_scraper_recycle_verification(
        recycled_scraper_windows,
        &before,
        &after,
        recycle_started_at.elapsed().as_millis(),
    );
    let scrape_start_budget_bytes = scrape_memory_start_budget_bytes(&after);
    let scrape_resident_budget_bytes = scrape_resident_start_budget_bytes(&after);
    let may_proceed = scrape_memory_may_proceed(&after);
    let pressure_level = scrape_memory_pressure_level(&after);
    info!(
        "[memory] scrape preflight provider={} operation={} before_app_pressure={} before_app_rss={} before_webkit_pressure={} before_webkit_rss={} after_app_pressure={} after_app_rss={} after_webkit_pressure={} after_webkit_rss={} recycle_exited_pids={} recycle_retained_pids={} recycle_new_pids={} recycle_webkit_delta_bytes={} recycle_elapsed_ms={} scrape_budget={} resident_budget={} headroom_bytes={} high_bytes={} critical_bytes={} pressure={} recycled_scrapers={} cache_trimmed={} may_proceed={}",
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
        scraper_recycle_verification
            .as_ref()
            .map(|verification| verification.exited_process_ids.len())
            .unwrap_or(0),
        scraper_recycle_verification
            .as_ref()
            .map(|verification| verification.retained_process_ids.len())
            .unwrap_or(0),
        scraper_recycle_verification
            .as_ref()
            .map(|verification| verification.new_process_ids.len())
            .unwrap_or(0),
        scraper_recycle_verification
            .as_ref()
            .map(|verification| verification.webkit_resident_delta_bytes)
            .unwrap_or(0),
        scraper_recycle_verification
            .as_ref()
            .map(|verification| verification.elapsed_ms)
            .unwrap_or(0),
        scrape_start_budget_bytes,
        scrape_resident_budget_bytes,
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
            "scrapeResidentBudgetBytes": scrape_resident_budget_bytes,
            "effectiveResidentBytes": scrape_effective_resident_bytes(&after),
            "webkitResidentTailReclaimable": webkit_resident_tail_is_probably_reclaimable(&after),
            "scrapeHeadroomBytes": SCRAPE_MEMORY_HEADROOM_BYTES,
            "memoryHighBytes": after.memory_high_bytes,
            "memoryCriticalBytes": after.memory_critical_bytes,
            "pressureLevel": pressure_level,
            "recycledScraperWindows": recycled_scraper_windows,
            "scraperRecycleVerification": &scraper_recycle_verification,
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
        scraper_recycle_verification,
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

    let pressure_level = scrape_memory_pressure_level(&prep.after);
    let pressure_label = if pressure_level == "critical" {
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
            "scrapeResidentBudgetBytes": scrape_resident_start_budget_bytes(&prep.after),
            "effectiveResidentBytes": scrape_effective_resident_bytes(&prep.after),
            "webkitResidentTailReclaimable": webkit_resident_tail_is_probably_reclaimable(&prep.after),
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
    include_storage_sizes: Option<bool>,
    precise_webkit_attribution: Option<bool>,
) -> Result<RuntimeMemoryStats, String> {
    let relay_doc_bytes = state
        .current_doc
        .read()
        .await
        .as_ref()
        .map(|doc| doc.len() as u64)
        .unwrap_or(0);
    let relay_client_count = *state.client_count.read().await as u64;

    Ok(collect_runtime_memory_stats_with_options(
        &app,
        relay_doc_bytes,
        relay_client_count,
        RuntimeMemoryStatsOptions {
            include_storage_sizes: include_storage_sizes.unwrap_or(true),
            precise_webkit_attribution: precise_webkit_attribution.unwrap_or(true),
        },
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
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&data_dir).ok();
    prepare_startup_recovery_retry(&data_dir);

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        scrub_webview_before_destroy(&window);
        window
            .destroy()
            .map_err(|error| format!("failed to reset main window: {}", error))?;
        wait_for_main_window_release(&app, "startup recovery retry")?;
    }

    let window = create_main_window(&app).map_err(|error| error.to_string())?;
    show_webview_window(&window);
    Ok(())
}

#[tauri::command]
fn export_startup_diagnostics(app: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let downloads_dir = app
        .path()
        .download_dir()
        .map_err(|error| error.to_string())?;
    let path = write_startup_diagnostics_bundle(
        &data_dir,
        &downloads_dir,
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
    )?;
    Ok(path.to_string_lossy().into_owned())
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

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FbGroupMembershipPayload {
    id: String,
    url: String,
    name: Option<String>,
    still_joined: Option<bool>,
    reason: String,
    checked_at: u64,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FbPageStatePayload {
    logged_in_cookie: bool,
    scroll_height: u64,
    feed_posts_heading_count: u64,
    feed_unit_count: u64,
    login_chrome: bool,
    role_main_count: u64,
    url: String,
    title: String,
}

impl FbPageStatePayload {
    fn feed_like(&self) -> bool {
        self.logged_in_cookie || self.feed_posts_heading_count > 0 || self.feed_unit_count > 0
    }
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct IgFeedStatePayload {
    logged_in_cookie: bool,
    article_count: u64,
    ready_article_count: u64,
    tiny_article_count: u64,
    first_article_height: u64,
    first_article_text_length: u64,
    first_article_media_count: u64,
    scroll_height: u64,
    document_ready_state: String,
    login_chrome: bool,
    main_found: bool,
    url: String,
    title: String,
}

impl IgFeedStatePayload {
    fn placeholders_only(&self) -> bool {
        self.article_count > 0 && self.ready_article_count == 0 && self.tiny_article_count > 0
    }

    fn feed_ready(&self) -> bool {
        self.ready_article_count > 0 && !self.login_chrome
    }

    fn diagnostic_summary(&self) -> String {
        format!(
            "ready_articles={}, tiny_articles={}, articles={}, scroll_height={}, first_article_height={}, first_article_text_length={}, first_article_media_count={}, ready_state={}, logged_in_cookie={}, login_chrome={}, main_found={}, url={}",
            self.ready_article_count,
            self.tiny_article_count,
            self.article_count,
            self.scroll_height,
            self.first_article_height,
            self.first_article_text_length,
            self.first_article_media_count,
            self.document_ready_state,
            self.logged_in_cookie,
            self.login_chrome,
            self.main_found,
            &self.url[..self.url.len().min(80)]
        )
    }
}

fn fb_page_state_probe_script() -> &'static str {
    r#"
    (function() {
        try {
            var headings = Array.prototype.filter.call(document.querySelectorAll('h3'), function(h3) {
                return (h3.textContent || '').trim() === 'Feed posts';
            }).length;
            var bodyText = ((document.body && document.body.textContent) || '').slice(0, 4000).toLowerCase();
            var feedUnitCount = document.querySelectorAll('[role="article"], div[data-pagelet^="FeedUnit"], div[aria-posinset]').length;
            window.__TAURI__.event.emit('fb-page-state', {
                loggedInCookie: document.cookie.indexOf('c_user=') !== -1 &&
                    document.cookie.indexOf('c_user=0') === -1,
                scrollHeight: document.documentElement.scrollHeight || document.body.scrollHeight || 0,
                feedPostsHeadingCount: headings,
                feedUnitCount: feedUnitCount,
                loginChrome: /\blog in\b/.test(bodyText) ||
                    /\bsign up\b/.test(bodyText) ||
                    /\bcreate new account\b/.test(bodyText),
                roleMainCount: document.querySelectorAll('div[role="main"]').length,
                url: window.location.href,
                title: document.title || ''
            });
        } catch (e) {
            window.__TAURI__.event.emit('fb-page-state', {
                loggedInCookie: false,
                scrollHeight: 0,
                feedPostsHeadingCount: 0,
                feedUnitCount: 0,
                loginChrome: false,
                roleMainCount: 0,
                url: window.location.href,
                title: document.title || '',
                error: e.message || String(e)
            });
        }
    })();
    "#
}

fn ig_feed_state_probe_script() -> &'static str {
    r#"
    (function() {
        try {
            var articles = Array.prototype.slice.call(document.querySelectorAll("article, [role='article']"));
            var ready = 0;
            var tiny = 0;
            var firstArticle = articles[0] || null;
            var firstArticleHeight = firstArticle ? (firstArticle.offsetHeight || 0) : 0;
            var firstArticleTextLength = firstArticle ? ((firstArticle.textContent || "").trim().length) : 0;
            var firstArticleMediaCount = firstArticle
                ? firstArticle.querySelectorAll("img[src*='cdninstagram'], img[src*='scontent'], img[srcset], video").length
                : 0;
            articles.forEach(function(article) {
                var height = article.offsetHeight || 0;
                if (height < 100) {
                    tiny += 1;
                    return;
                }
                var hasContent = !!(
                    article.querySelector("time, img[src*='cdninstagram'], img[src*='scontent'], video") ||
                    Array.prototype.some.call(article.querySelectorAll("[dir='auto']"), function(node) {
                        return ((node.textContent || "").trim().length > 15);
                    })
                );
                if (hasContent) ready += 1;
            });
            var bodyText = ((document.body && document.body.textContent) || "").slice(0, 4000).toLowerCase();
            window.__TAURI__.event.emit("ig-feed-state", {
                loggedInCookie: document.cookie.indexOf("sessionid=") !== -1 &&
                    document.cookie.indexOf("sessionid=;") === -1,
                articleCount: articles.length,
                readyArticleCount: ready,
                tinyArticleCount: tiny,
                firstArticleHeight: firstArticleHeight,
                firstArticleTextLength: firstArticleTextLength,
                firstArticleMediaCount: firstArticleMediaCount,
                scrollHeight: document.documentElement.scrollHeight || document.body.scrollHeight || 0,
                documentReadyState: document.readyState || "",
                loginChrome: /\blog in\b/.test(bodyText) ||
                    /\bsign up\b/.test(bodyText) ||
                    /\blog into instagram\b/.test(bodyText),
                mainFound: !!(document.querySelector("main") || document.querySelector("[role='main']")),
                url: window.location.href,
                title: document.title || ""
            });
        } catch (e) {
            window.__TAURI__.event.emit("ig-feed-state", {
                loggedInCookie: false,
                articleCount: 0,
                readyArticleCount: 0,
                tinyArticleCount: 0,
                firstArticleHeight: 0,
                firstArticleTextLength: 0,
                firstArticleMediaCount: 0,
                scrollHeight: 0,
                documentReadyState: document.readyState || "",
                loginChrome: false,
                mainFound: false,
                url: window.location.href,
                title: document.title || "",
                error: e.message || String(e)
            });
        }
    })();
    "#
}

fn fb_auth_result_script() -> &'static str {
    r#"
    (function() {
        try {
            var headings = Array.prototype.filter.call(document.querySelectorAll('h3'), function(h3) {
                return (h3.textContent || '').trim() === 'Feed posts';
            }).length;
            var scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
            var roleMainCount = document.querySelectorAll('div[role="main"]').length;
            var feedUnitCount = document.querySelectorAll('[role="article"], div[data-pagelet^="FeedUnit"], div[aria-posinset]').length;
            var bodyText = ((document.body && document.body.textContent) || '').slice(0, 4000).toLowerCase();
            var loginChrome = /\blog in\b/.test(bodyText) ||
                /\bsign up\b/.test(bodyText) ||
                /\bcreate new account\b/.test(bodyText);
            var loggedInCookie = document.cookie.indexOf('c_user=') !== -1 &&
                document.cookie.indexOf('c_user=0') === -1;
            var feedLike = loggedInCookie || headings > 0 || feedUnitCount > 0;
            window.__TAURI__.event.emit('fb-auth-result', {
                loggedIn: loggedInCookie || feedLike,
                loggedInCookie: loggedInCookie,
                feedLike: feedLike,
                scrollHeight: scrollHeight,
                feedPostsHeadingCount: headings,
                feedUnitCount: feedUnitCount,
                loginChrome: loginChrome,
                roleMainCount: roleMainCount,
                url: window.location.href,
                title: document.title || ''
            });
        } catch(e) {
            window.__TAURI__.event.emit('fb-auth-result', { loggedIn: false, error: e.message || String(e) });
        }
    })();
    "#
}

async fn probe_fb_page_state(
    app: &tauri::AppHandle,
    wv: &tauri::WebviewWindow,
) -> Result<FbPageStatePayload, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<FbPageStatePayload, String>>();
    let tx = Arc::new(std::sync::Mutex::new(Some(tx)));
    let listener_tx = tx.clone();
    let listener_id = app.listen("fb-page-state", move |event| {
        let result = serde_json::from_str::<FbPageStatePayload>(event.payload())
            .map_err(|err| err.to_string());
        if let Some(sender) = listener_tx.lock().unwrap().take() {
            let _ = sender.send(result);
        }
    });

    let eval_result = wv
        .eval(fb_page_state_probe_script())
        .map_err(|e| e.to_string());
    if let Err(err) = eval_result {
        app.unlisten(listener_id);
        return Err(err);
    }
    let result = tokio::time::timeout(Duration::from_secs(2), rx)
        .await
        .map_err(|_| "Timed out checking Facebook page state".to_string())
        .and_then(|received| {
            received.map_err(|_| "Facebook page state listener dropped".to_string())
        });
    app.unlisten(listener_id);
    result?
}

async fn probe_ig_feed_state(
    app: &tauri::AppHandle,
    wv: &tauri::WebviewWindow,
) -> Result<IgFeedStatePayload, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<IgFeedStatePayload, String>>();
    let tx = Arc::new(std::sync::Mutex::new(Some(tx)));
    let listener_tx = tx.clone();
    let listener_id = app.listen("ig-feed-state", move |event| {
        let result = serde_json::from_str::<IgFeedStatePayload>(event.payload())
            .map_err(|err| err.to_string());
        if let Some(sender) = listener_tx.lock().unwrap().take() {
            let _ = sender.send(result);
        }
    });

    let eval_result = wv
        .eval(ig_feed_state_probe_script())
        .map_err(|e| e.to_string());
    if let Err(err) = eval_result {
        app.unlisten(listener_id);
        return Err(err);
    }
    let result = tokio::time::timeout(Duration::from_secs(2), rx)
        .await
        .map_err(|_| "Timed out checking Instagram feed state".to_string())
        .and_then(|received| {
            received.map_err(|_| "Instagram feed state listener dropped".to_string())
        });
    app.unlisten(listener_id);
    result?
}

async fn wait_for_ig_feed_state(
    app: &tauri::AppHandle,
    wv: &tauri::WebviewWindow,
    attempts: usize,
) -> IgFeedStatePayload {
    let mut last_state = IgFeedStatePayload::default();
    for attempt in 1..=attempts.max(1) {
        match probe_ig_feed_state(app, wv).await {
            Ok(state) => {
                info!(
                    "[IG] feed state attempt={}/{} {}",
                    attempt,
                    attempts.max(1),
                    state.diagnostic_summary()
                );
                let ready = state.feed_ready();
                last_state = state;
                if ready {
                    return last_state;
                }
            }
            Err(err) => {
                warn!(
                    "[IG] feed state probe failed attempt={}/{} error={}",
                    attempt,
                    attempts.max(1),
                    err
                );
            }
        }
        tokio::time::sleep(Duration::from_millis(gaussian_ms(1400.0, 250.0))).await;
    }
    last_state
}

/// Show a visible WebView window navigated to facebook.com/login so the
/// user can authenticate through the real Facebook login flow.
///
/// The window uses the "fb-login" label and shares the Facebook scraper data
/// store, so login cookies remain available to feed scraping.
///
/// An `on_navigation` handler detects when the user completes login
/// (URL leaves /login) and emits `fb-auth-result`.
#[tauri::command]
async fn fb_show_login(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
    user_agent: String,
) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    info!("[FB] opening login window");
    recycle_webview_window(&app, "fb-scraper", "facebook reconnect");

    if let Some(existing) = app.get_webview_window("fb-login") {
        let _ = set_background_scraper_window_cloak(&existing, false);
        let _ = set_background_scraper_media_guard(&existing, false);
        existing
            .navigate("https://www.facebook.com/login".parse().unwrap())
            .map_err(|e| e.to_string())?;
        let _ = existing.show();
        let _ = existing.set_focus();
        *capture.fb_user_agent.lock().unwrap() = user_agent;
        info!("[FB] focused existing login window");
        return Ok(());
    }

    let app_handle = app.clone();
    let auth_emitted = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let auth_emitted_for_nav = auth_emitted.clone();

    let login_window = WebviewWindowBuilder::new(
        &app,
        "fb-login",
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

        // Detect likely login completion, then verify with page evidence.
        if host.contains("facebook.com")
            && path != "/login"
            && path != "/login/"
            && !auth_emitted_for_nav.swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            let check_app = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(1800)).await;
                if let Some(w) = check_app.get_webview_window("fb-login") {
                    let _ = w.eval(fb_auth_result_script());
                }
            });
        }

        true
    })
    .build()
    .map_err(|e| e.to_string())?;
    let close_app = app.clone();
    login_window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            let _ = close_app.emit(
                "fb-login-window-closed",
                serde_json::json!({ "closed": true }),
            );
        }
    });

    *capture.fb_user_agent.lock().unwrap() = user_agent;
    info!("[FB] created login window");

    Ok(())
}

/// Hide the Facebook login window after successful authentication.
#[tauri::command]
async fn fb_hide_login(app: tauri::AppHandle) -> Result<(), String> {
    let _ = app.emit(
        "fb-login-window-closed",
        serde_json::json!({ "closed": true }),
    );
    recycle_webview_window(&app, "fb-login", "login dismissed");
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
    ensure_social_scrape_memory(
        &app,
        &capture.background_runtime,
        "Facebook",
        "auth check",
        Some("fb-scraper"),
    )
    .await?;
    let _scraper_session = acquire_background_scraper_session(&capture, "fb_check_auth").await?;
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

    wv.eval(fb_auth_result_script())
        .map_err(|e| e.to_string())?;

    tokio::time::sleep(Duration::from_millis(250)).await;

    // The result is delivered asynchronously via event. The frontend listens
    // for 'fb-auth-result'. Since eval() return values are not available here,
    // the command return value is only a fallback for missed events.
    Ok(false)
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
    let scrape_run_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| format!("fb-{}", duration.as_millis()))
        .unwrap_or_else(|_| "fb-unknown".to_string());
    ensure_social_scrape_memory(
        &app,
        &capture.background_runtime,
        "Facebook",
        "feed scrape",
        None,
    )
    .await?;
    let _scraper_session = acquire_background_scraper_session(&capture, "fb_scrape_feed").await?;
    let recycle_guard = WebviewRecycleGuard::new(app.clone(), "fb-scraper", "feed scrape complete");

    let wv = match app.get_webview_window("fb-scraper") {
        Some(w) => {
            prepare_background_scraper_window(&w, window_mode)?;
            w.navigate(fb_feed_url.parse().unwrap())
                .map_err(|e| e.to_string())?;
            w
        }
        None => {
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
            .inner_size(1280.0, 900.0);

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
        "[FB] scrape started (run_id={}, window_mode={}), waiting for page load...",
        scrape_run_id,
        window_mode.as_str()
    );
    emit_social_scrape_lifecycle(
        &app,
        "fb-scrape-started",
        "facebook",
        Some(&wv),
        window_mode,
        None,
    );

    tokio::time::sleep(Duration::from_millis(gaussian_ms(13000.0, 1500.0))).await;

    let set_scrape_run_id_script = format!(
        "window.__FREED_FB_SCRAPE_RUN_ID = {};",
        serde_json::to_string(&scrape_run_id).map_err(|e| e.to_string())?
    );
    wv.eval(&set_scrape_run_id_script)
        .map_err(|e| e.to_string())?;

    wv.eval(
        r#"
        (function() {
            if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.emit) {
                window.__TAURI__.event.emit('fb-diag', {
                    scrapeRunId: window.__FREED_FB_SCRAPE_RUN_ID || null,
                    userAgent: navigator.userAgent,
                    url: window.location.href,
                    title: document.title,
                    scrollHeight: document.documentElement.scrollHeight,
                    loggedInCookie: document.cookie.indexOf('c_user=') !== -1 &&
                        document.cookie.indexOf('c_user=0') === -1,
                    feedPostsHeadingCount: Array.prototype.filter.call(document.querySelectorAll('h3'), function(h3) {
                        return (h3.textContent || '').trim() === 'Feed posts';
                    }).length,
                    roleMainCount: document.querySelectorAll('div[role="main"]').length,
                });
            }
        })();
    "#,
    )
    .map_err(|e| e.to_string())?;
    tokio::time::sleep(Duration::from_millis(300)).await;

    let page_state = probe_fb_page_state(&app, &wv).await?;
    let feed_like = page_state.feed_like();
    let short_non_feed = page_state.scroll_height > 0
        && page_state.scroll_height < 1600
        && page_state.feed_posts_heading_count == 0;
    let not_authenticated = !page_state.logged_in_cookie && !feed_like;
    if not_authenticated || short_non_feed {
        let message = if not_authenticated {
            "Facebook did not render an authenticated feed. Reconnect Facebook and try again."
        } else {
            "Facebook rendered a short page instead of the feed. Open Facebook settings, reconnect if needed, then sync again."
        };
        let strategy = if not_authenticated {
            "not_authenticated"
        } else {
            "short_non_feed"
        };
        let extracted_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);
        let _ = app.emit(
            "fb-feed-data",
            serde_json::json!({
                "posts": [],
                "error": message,
                "extractedAt": extracted_at,
                "url": page_state.url,
                "scrapeRunId": scrape_run_id,
                "strategy": strategy,
                "candidateCount": 0,
                "scrollY": 0,
                "feedContainerFound": page_state.feed_posts_heading_count > 0,
                "pageState": page_state,
                "rejected": {
                    "suggestedOrSponsored": 0,
                    "missingAuthor": 0,
                    "missingContent": 0
                }
            }),
        );
        emit_social_scrape_lifecycle(
            &app,
            "fb-scrape-start-failed",
            "facebook",
            Some(&wv),
            window_mode,
            Some(message),
        );
        return Err(message.to_string());
    }

    emit_social_scrape_lifecycle(
        &app,
        "fb-scrape-healthy",
        "facebook",
        Some(&wv),
        window_mode,
        Some("authenticated feed rendered"),
    );

    let scrape_plan_stats = collect_runtime_memory_stats(&app, 0, 0);
    let scrape_plan = social_scrape_plan_for_memory(&scrape_plan_stats, 6, 10);
    emit_social_scrape_plan(
        &app,
        "Facebook",
        "feed scrape",
        &scrape_plan,
        &scrape_plan_stats,
    );

    // Randomized ordering: ~50% stories-first, ~50% feed-first.
    // ~15% chance to skip story scraping entirely (real users don't always check stories).
    let skip_stories = scrape_plan.skip_stories
        || !optional_story_scrape_may_continue(&app, "Facebook", "feed scrape")
        || {
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
        rand::thread_rng().gen_range(scrape_plan.min_passes.max(1)..=scrape_plan.max_passes.max(1))
    };
    // If doing feed-first, split the passes: 2-4 passes before stories, rest after.
    let early_passes = if !stories_first && !skip_stories {
        use rand::Rng;
        let upper = 4usize.min(num_passes.saturating_sub(1).max(1));
        let lower = 2usize.min(upper);
        rand::thread_rng().gen_range(lower..=upper)
    } else {
        num_passes // all passes in one go
    };

    let mut completed_passes = 0usize;
    for i in 0..num_passes {
        prepare_background_scraper_window(&wv, window_mode)?;

        wv.eval(FB_EXTRACT_SCRIPT)
            .map_err(|e| format!("Failed to inject extraction script: {}", e))?;

        tokio::time::sleep(Duration::from_millis(300)).await;
        cleanup_background_scraper_media(&wv);
        completed_passes = i + 1;
        if !social_scrape_may_continue(&app, "Facebook", "feed scrape", i + 1, num_passes) {
            break;
        }

        let scroll_amount = {
            use rand::Rng;
            rand::thread_rng().gen_range(280u64..520)
        };
        let scroll_js = social_feed_scroll_script(scroll_amount as i64);
        wv.eval(&scroll_js).map_err(|e| e.to_string())?;
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
            let back_js = social_feed_scroll_script(-(back as i64));
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
            let _ = wv.eval("window.scrollTo({ top: 0, behavior: 'auto' });");
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
        completed_passes + 1
    );
    drop(wv);
    drop(recycle_guard);
    maybe_recover_after_social_feed_scrape(
        &app,
        &capture.background_runtime,
        "Facebook",
        &scrape_plan_stats,
    )
    .await;

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
    ensure_social_scrape_memory(
        &app,
        &capture.background_runtime,
        "Facebook",
        "groups scrape",
        None,
    )
    .await?;
    let _scraper_session = acquire_background_scraper_session(&capture, "fb_scrape_groups").await?;
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
            .inner_size(1280.0, 900.0);

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

    let mut groups_by_id: HashMap<String, FbGroupInfoPayload> = HashMap::new();
    let mut unchanged_passes = 0usize;
    let max_passes = 24usize;

    for pass in 0..max_passes {
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
            Ok(Err(_)) => {
                app.unlisten(listener_id);
                Err("Groups scrape channel closed".to_string())?
            }
            Err(_) => {
                app.unlisten(listener_id);
                Err("Groups scrape timed out after 10 seconds".to_string())?
            }
        };

        app.unlisten(listener_id);

        let before_len = groups_by_id.len();
        for group in groups {
            match groups_by_id.get(&group.id) {
                Some(existing) if existing.name.len() >= group.name.len() => {}
                _ => {
                    groups_by_id.insert(group.id.clone(), group);
                }
            }
        }

        let after_len = groups_by_id.len();
        if after_len == before_len {
            unchanged_passes += 1;
        } else {
            unchanged_passes = 0;
        }

        info!(
            "[FB] groups scrape pass {}/{}: {} unique groups",
            pass + 1,
            max_passes,
            after_len
        );

        if pass >= 4 && unchanged_passes >= 4 {
            break;
        }

        let scroll_js = r#"
            (function() {
                var amount = Math.max(600, Math.floor((window.innerHeight || 900) * 0.85));
                window.scrollBy({ top: amount, left: 0, behavior: "auto" });
            })();
        "#;
        let _ = wv.eval(scroll_js);
        tokio::time::sleep(Duration::from_millis(gaussian_ms(900.0, 180.0))).await;
    }

    Ok(groups_by_id.into_values().collect())
}

#[tauri::command]
async fn fb_check_group_membership(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
    group_id: String,
    group_url: String,
    window_mode: ScraperWindowMode,
) -> Result<FbGroupMembershipPayload, String> {
    use tauri::WebviewWindowBuilder;

    let scraper_user_agent = stored_or_default_user_agent(&capture.fb_user_agent);
    ensure_social_scrape_memory(
        &app,
        &capture.background_runtime,
        "Facebook",
        "single group membership check",
        None,
    )
    .await?;
    let _scraper_session =
        acquire_background_scraper_session(&capture, "fb_check_group_membership").await?;
    let _recycle_guard =
        WebviewRecycleGuard::new(app.clone(), "fb-scraper", "group membership check complete");

    let wv = match app.get_webview_window("fb-scraper") {
        Some(w) => {
            prepare_background_scraper_window(&w, window_mode)?;
            w.navigate(group_url.parse::<url::Url>().map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            w
        }
        None => {
            let mut builder = WebviewWindowBuilder::new(
                &app,
                "fb-scraper",
                tauri::WebviewUrl::External(
                    group_url.parse::<url::Url>().map_err(|e| e.to_string())?,
                ),
            )
            .data_store_identifier(FB_SCRAPER_DATA_STORE_IDENTIFIER)
            .user_agent(&scraper_user_agent)
            .initialization_script(include_str!("webkit-mask.js"))
            .initialization_script(INITIALIZE_BACKGROUND_SCRAPER_MEDIA_GUARD_JS)
            .title("Freed Facebook")
            .inner_size(1280.0, 900.0);

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

    tokio::time::sleep(Duration::from_millis(gaussian_ms(4500.0, 700.0))).await;

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<FbGroupMembershipPayload, String>>();
    let tx = Arc::new(std::sync::Mutex::new(Some(tx)));
    let listener_tx = tx.clone();
    let listener_id = app.listen("fb-group-membership", move |event| {
        let result = serde_json::from_str::<FbGroupMembershipPayload>(event.payload())
            .map_err(|err| err.to_string());

        if let Some(sender) = listener_tx.lock().unwrap().take() {
            let _ = sender.send(result);
        }
    });

    let group_id_json = serde_json::to_string(&group_id).map_err(|e| e.to_string())?;
    let group_url_json = serde_json::to_string(&group_url).map_err(|e| e.to_string())?;
    let script = format!(
        r#"
        (function(groupId, groupUrl) {{
          function normalizeText(value) {{
            return String(value || "")
              .replace(/\u200b/g, "")
              .replace(/\s+/g, " ")
              .replace(/(\S)(last active\b)/i, "$1 $2")
              .trim()
              .replace(/^(?:\d+\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mos|month|months|y|yr|yrs|year|years)(?:\s+ago)?|just now)\s+(?=\S)/i, "")
              .trim();
          }}
          function cleanName(value) {{
            var text = normalizeText(value);
            text = text.replace(/\s+\|\s+Facebook$/i, "").trim();
            text = text.replace(/\s+Facebook$/i, "").trim();
            return text;
          }}
          function candidateName() {{
            var metaTitle = document.querySelector('meta[property="og:title"], meta[name="twitter:title"]');
            var candidates = [
              document.querySelector("h1"),
              document.querySelector('[role="main"] h1'),
              document.querySelector('span[dir="auto"]')
            ];
            if (metaTitle) {{
              var metaName = cleanName(metaTitle.getAttribute("content"));
              if (metaName && metaName.toLowerCase() !== "facebook") return metaName;
            }}
            for (var i = 0; i < candidates.length; i++) {{
              var name = cleanName(candidates[i] && candidates[i].textContent);
              if (name && name.toLowerCase() !== "facebook") return name;
            }}
            var titleName = cleanName(document.title);
            return titleName && titleName.toLowerCase() !== "facebook" ? titleName : null;
          }}
          function visibleControlTexts() {{
            var nodes = document.querySelectorAll('button, [role="button"], a[role="button"]');
            var texts = [];
            for (var i = 0; i < nodes.length; i++) {{
              var node = nodes[i];
              var rect = node.getBoundingClientRect ? node.getBoundingClientRect() : {{ width: 1, height: 1 }};
              if (rect.width === 0 && rect.height === 0) continue;
              var text = normalizeText(
                node.getAttribute("aria-label") ||
                  node.getAttribute("title") ||
                  node.textContent
              );
              if (text) texts.push(text);
            }}
            return texts;
          }}
          var texts = visibleControlTexts();
          var joined = texts.some(function(text) {{
            return /^(joined|leave group)$/i.test(text) || /\bleave group\b/i.test(text);
          }});
          var notJoined = texts.some(function(text) {{
            return /^(join group|request to join)$/i.test(text) || /\bjoin group\b/i.test(text);
          }});
          var stillJoined = null;
          var reason = "membership control not found";
          if (joined && !notJoined) {{
            stillJoined = true;
            reason = "joined control found";
          }} else if (notJoined && !joined) {{
            stillJoined = false;
            reason = "join control found";
          }} else if (joined && notJoined) {{
            reason = "conflicting membership controls found";
          }}
          window.__TAURI__.event.emit("fb-group-membership", {{
            id: groupId,
            url: window.location.href || groupUrl,
            name: candidateName(),
            stillJoined: stillJoined,
            reason: reason,
            checkedAt: Date.now()
          }});
        }})({group_id_json}, {group_url_json});
        "#
    );

    wv.eval(&script)
        .map_err(|e| format!("Failed to inject group membership script: {}", e))?;

    let result = match timeout(Duration::from_secs(10), rx).await {
        Ok(Ok(result)) => result?,
        Ok(Err(_)) => Err("Group membership check channel closed".to_string())?,
        Err(_) => Err("Group membership check timed out after 10 seconds".to_string())?,
    };

    app.unlisten(listener_id);
    Ok(result)
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
            let comments_scroll_js = social_feed_scroll_script(520);
            let _ = wv.eval(&comments_scroll_js);
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
/// (URL leaves /accounts/login) and emits `ig-auth-result`.
#[tauri::command]
async fn ig_show_login(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
    user_agent: String,
) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    recycle_webview_window(&app, "ig-scraper", "login restart");

    let app_handle = app.clone();
    // Track whether we've already emitted the auth result (one-shot)
    let auth_emitted = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    let login_window = WebviewWindowBuilder::new(
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
            let _ = app_handle.emit("ig-auth-result", serde_json::json!({ "loggedIn": true }));
        }

        true
    })
    .build()
    .map_err(|e| e.to_string())?;
    let close_app = app.clone();
    login_window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            let _ = close_app.emit(
                "ig-login-window-closed",
                serde_json::json!({ "closed": true }),
            );
        }
    });

    *capture.ig_user_agent.lock().unwrap() = user_agent;

    Ok(())
}

/// Hide the Instagram login window after successful authentication.
#[tauri::command]
async fn ig_hide_login(app: tauri::AppHandle) -> Result<(), String> {
    let _ = app.emit(
        "ig-login-window-closed",
        serde_json::json!({ "closed": true }),
    );
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
    ensure_social_scrape_memory(
        &app,
        &capture.background_runtime,
        "Instagram",
        "auth check",
        Some("ig-scraper"),
    )
    .await?;
    let _scraper_session = acquire_background_scraper_session(&capture, "ig_check_auth").await?;
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

    Ok(false)
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
    ensure_social_scrape_memory(
        &app,
        &capture.background_runtime,
        "Instagram",
        "feed scrape",
        None,
    )
    .await?;
    let _scraper_session = acquire_background_scraper_session(&capture, "ig_scrape_feed").await?;
    let recycle_guard = WebviewRecycleGuard::new(app.clone(), "ig-scraper", "feed scrape complete");

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
            .inner_size(1280.0, 900.0);

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
    emit_social_scrape_lifecycle(
        &app,
        "ig-scrape-started",
        "instagram",
        Some(&wv),
        window_mode,
        None,
    );

    tokio::time::sleep(Duration::from_millis(gaussian_ms(9000.0, 1200.0))).await;

    info!("[IG] waiting for feed to render, proceeding with extraction");

    // Belt-and-suspenders: click the Following tab if present
    let _ = wv.eval(r#"document.querySelector('a[href="/?variant=following"]')?.click();"#);
    tokio::time::sleep(Duration::from_millis(2000)).await;
    let mut initial_feed_state = wait_for_ig_feed_state(&app, &wv, 6).await;
    if initial_feed_state.placeholders_only() {
        info!(
            "[IG] placeholder feed detected before extraction, attempting one feed refresh: {}",
            initial_feed_state.diagnostic_summary()
        );
        tokio::time::sleep(Duration::from_millis(gaussian_ms(1800.0, 450.0))).await;
        wv.navigate(ig_feed_url.parse::<url::Url>().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        tokio::time::sleep(Duration::from_millis(gaussian_ms(6500.0, 900.0))).await;
        let _ = wv.eval(r#"document.querySelector('a[href="/?variant=following"]')?.click();"#);
        tokio::time::sleep(Duration::from_millis(gaussian_ms(1400.0, 250.0))).await;
        initial_feed_state = wait_for_ig_feed_state(&app, &wv, 6).await;
        if initial_feed_state.placeholders_only() {
            let message = format!(
                "placeholder_feed: Instagram loaded placeholder feed articles after one refresh. {}",
                initial_feed_state.diagnostic_summary()
            );
            warn!("[IG] {}", message);
            return Err(message);
        }
        info!(
            "[IG] placeholder feed recovered after one refresh: {}",
            initial_feed_state.diagnostic_summary()
        );
    }

    let scrape_plan_stats = collect_runtime_memory_stats(&app, 0, 0);
    let scrape_plan = social_scrape_plan_for_memory(&scrape_plan_stats, 5, 9);
    emit_social_scrape_plan(
        &app,
        "Instagram",
        "feed scrape",
        &scrape_plan,
        &scrape_plan_stats,
    );

    // Randomized ordering: ~50% stories-first, ~50% feed-first.
    // ~15% chance to skip story scraping entirely.
    let placeholder_feed = initial_feed_state.placeholders_only();
    let skip_stories = scrape_plan.skip_stories
        || !optional_story_scrape_may_continue(&app, "Instagram", "feed scrape")
        || (!placeholder_feed && {
            use rand::Rng;
            rand::thread_rng().gen_bool(0.15)
        });
    let stories_first = !skip_stories && {
        use rand::Rng;
        placeholder_feed || rand::thread_rng().gen_bool(0.50)
    };
    let story_frame_cap = {
        use rand::Rng;
        rand::thread_rng().gen_range(2usize..=4)
    };

    if stories_first {
        if initial_feed_state.placeholders_only() {
            info!("[IG] stories first because feed rendered placeholder articles only");
        } else {
            println!("[IG] coin flip: stories FIRST");
        }
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
        rand::thread_rng().gen_range(scrape_plan.min_passes.max(1)..=scrape_plan.max_passes.max(1))
    };
    // Feed-first: scrape stories after the first 2-4 passes
    let early_passes = if !stories_first && !skip_stories {
        use rand::Rng;
        let upper = 4usize.min(num_passes.saturating_sub(1).max(1));
        let lower = 2usize.min(upper);
        rand::thread_rng().gen_range(lower..=upper)
    } else {
        num_passes
    };

    let mut completed_passes = 0usize;
    for i in 0..num_passes {
        prepare_background_scraper_window(&wv, window_mode)?;

        wv.eval(IG_EXTRACT_SCRIPT)
            .map_err(|e| format!("Failed to inject extraction script: {}", e))?;

        tokio::time::sleep(Duration::from_millis(300)).await;
        if i == 0 {
            emit_social_scrape_lifecycle(
                &app,
                "ig-scrape-healthy",
                "instagram",
                Some(&wv),
                window_mode,
                Some("first extraction pass injected"),
            );
        }
        cleanup_background_scraper_media(&wv);
        completed_passes = i + 1;
        if !social_scrape_may_continue(&app, "Instagram", "feed scrape", i + 1, num_passes) {
            break;
        }

        let scroll_amount = {
            use rand::Rng;
            rand::thread_rng().gen_range(380u64..720)
        };
        let scroll_js = social_feed_scroll_script(scroll_amount as i64);
        wv.eval(&scroll_js).map_err(|e| e.to_string())?;
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
            let back_js = social_feed_scroll_script(-(back as i64));
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
                    window.scrollTo({ top: 0, behavior: 'auto' });
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
        completed_passes + 1
    );
    drop(wv);
    drop(recycle_guard);
    maybe_recover_after_social_feed_scrape(
        &app,
        &capture.background_runtime,
        "Instagram",
        &scrape_plan_stats,
    )
    .await;

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
            let comments_scroll_js = social_feed_scroll_script(520);
            let _ = wv.eval(&comments_scroll_js);
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
    ensure_social_scrape_memory(&app, &capture.background_runtime, "Facebook", "visit", None)
        .await?;
    let _scraper_session = acquire_background_scraper_session(&capture, "fb_visit_url").await?;
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
    ensure_social_scrape_memory(
        &app,
        &capture.background_runtime,
        "Instagram",
        "visit",
        None,
    )
    .await?;
    let _scraper_session = acquire_background_scraper_session(&capture, "ig_visit_url").await?;
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
    ensure_social_scrape_memory(&app, &capture.background_runtime, "Facebook", "like", None)
        .await?;
    let _scraper_session = acquire_background_scraper_session(&capture, "fb_like_post").await?;
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
    ensure_social_scrape_memory(&app, &capture.background_runtime, "Instagram", "like", None)
        .await?;
    let _scraper_session = acquire_background_scraper_session(&capture, "ig_like_post").await?;
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
/// (URL leaves /login) and emits `li-auth-result`.
#[tauri::command]
async fn li_show_login(
    app: tauri::AppHandle,
    capture: tauri::State<'_, CaptureState>,
    user_agent: String,
) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    recycle_webview_window(&app, "li-scraper", "login restart");

    let app_handle = app.clone();
    // Track whether we've already emitted the auth result (one-shot)
    let auth_emitted = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    let login_window = WebviewWindowBuilder::new(
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
            let _ = app_handle.emit("li-auth-result", serde_json::json!({ "loggedIn": true }));
        }

        true
    })
    .build()
    .map_err(|e| e.to_string())?;
    let close_app = app.clone();
    login_window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            let _ = close_app.emit(
                "li-login-window-closed",
                serde_json::json!({ "closed": true }),
            );
        }
    });

    *capture.li_user_agent.lock().unwrap() = user_agent;

    Ok(())
}

/// Hide the LinkedIn login window after successful authentication.
#[tauri::command]
async fn li_hide_login(app: tauri::AppHandle) -> Result<(), String> {
    let _ = app.emit(
        "li-login-window-closed",
        serde_json::json!({ "closed": true }),
    );
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
    ensure_social_scrape_memory(
        &app,
        &capture.background_runtime,
        "LinkedIn",
        "auth check",
        Some("li-scraper"),
    )
    .await?;
    let _scraper_session = acquire_background_scraper_session(&capture, "li_check_auth").await?;
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

    Ok(false)
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
    ensure_social_scrape_memory(
        &app,
        &capture.background_runtime,
        "LinkedIn",
        "feed scrape",
        None,
    )
    .await?;
    let _scraper_session = acquire_background_scraper_session(&capture, "li_scrape_feed").await?;
    let recycle_guard = WebviewRecycleGuard::new(app.clone(), "li-scraper", "feed scrape complete");

    let wv = match app.get_webview_window("li-scraper") {
        Some(w) => {
            prepare_background_scraper_window(&w, window_mode)?;
            w.navigate(li_feed_url.parse().unwrap())
                .map_err(|e| e.to_string())?;
            w
        }
        None => {
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
            .inner_size(1280.0, 900.0);

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
    emit_social_scrape_lifecycle(
        &app,
        "li-scrape-started",
        "linkedin",
        Some(&wv),
        window_mode,
        None,
    );

    // LinkedIn's feed takes slightly longer to hydrate than Facebook.
    // Use a longer initial wait with more variance.
    tokio::time::sleep(Duration::from_millis(gaussian_ms(12000.0, 2000.0))).await;

    prepare_background_scraper_window(&wv, window_mode)?;
    println!("[LI] window prepared, proceeding with extraction");
    let scrape_plan_stats = collect_runtime_memory_stats(&app, 0, 0);

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
        if i == 0 {
            emit_social_scrape_lifecycle(
                &app,
                "li-scrape-healthy",
                "linkedin",
                Some(&wv),
                window_mode,
                Some("first extraction pass injected"),
            );
        }
        cleanup_background_scraper_media(&wv);
        if !social_scrape_may_continue(&app, "LinkedIn", "feed scrape", i + 1, num_passes) {
            break;
        }

        let scroll_amount = {
            use rand::Rng;
            rand::thread_rng().gen_range(350u64..650)
        };
        let scroll_js = social_feed_scroll_script(scroll_amount as i64);
        wv.eval(&scroll_js).map_err(|e| e.to_string())?;
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
            let back_js = social_feed_scroll_script(-(back as i64));
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
    drop(wv);
    drop(recycle_guard);
    maybe_recover_after_social_feed_scrape(
        &app,
        &capture.background_runtime,
        "LinkedIn",
        &scrape_plan_stats,
    )
    .await;

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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MainWindowPresentation {
    Foreground,
    Quiet,
}

impl MainWindowPresentation {
    fn should_focus(self) -> bool {
        matches!(self, MainWindowPresentation::Foreground)
    }

    fn should_recover_startup_occlusion(self) -> bool {
        self.should_focus()
    }
}

fn show_webview_window(window: &tauri::WebviewWindow) {
    present_webview_window(window, MainWindowPresentation::Foreground, "show");
}

fn quietly_show_webview_window(window: &tauri::WebviewWindow, context: &str) {
    quiet_show_webview_window(window, context);
}

fn present_webview_window(
    window: &tauri::WebviewWindow,
    presentation: MainWindowPresentation,
    context: &str,
) {
    show_app_for_main_window(window, presentation, context);
    let _ = window.show();
    let _ = window.unminimize();
    if presentation.should_focus() {
        let _ = window.set_focus();
        force_show_webview_window(window, context);
    } else {
        quietly_show_webview_window(window, context);
    }
}

#[cfg(target_os = "macos")]
fn show_app_for_main_window(
    window: &tauri::WebviewWindow,
    presentation: MainWindowPresentation,
    context: &str,
) {
    let app = window.app_handle();
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if presentation.should_focus() {
        let _ = app.show();
        force_activate_ns_app(context);
    } else {
        info!(
            "[main-window] quiet app presentation context={} activation_policy=regular",
            context
        );
    }
}

#[cfg(not(target_os = "macos"))]
fn show_app_for_main_window(
    _window: &tauri::WebviewWindow,
    _presentation: MainWindowPresentation,
    _context: &str,
) {
}

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
fn main_window_native_occlusion_state(window: &tauri::WebviewWindow) -> Option<usize> {
    let Ok(ns_window) = window.ns_window() else {
        return None;
    };

    let ns_window = ns_window.cast::<AnyObject>();
    Some(unsafe { msg_send![ns_window, occlusionState] })
}

#[cfg(not(target_os = "macos"))]
fn main_window_native_occlusion_state(_window: &tauri::WebviewWindow) -> Option<usize> {
    None
}

fn main_window_native_is_occluded(window: &tauri::WebviewWindow) -> Option<bool> {
    main_window_native_occlusion_state(window)
        .map(|state| state & NS_WINDOW_OCCLUSION_STATE_VISIBLE == 0)
}

#[cfg(target_os = "macos")]
fn log_main_window_native_state(window: &tauri::WebviewWindow, context: &str) {
    let Ok(ns_window) = window.ns_window() else {
        warn!(
            "[main-window] native state unavailable context={} reason=missing-ns-window",
            context
        );
        return;
    };

    let ns_window = ns_window.cast::<AnyObject>();
    unsafe {
        let frame: NSRect = msg_send![ns_window, frame];
        let alpha: f64 = msg_send![ns_window, alphaValue];
        let level: isize = msg_send![ns_window, level];
        let occlusion_state = main_window_native_occlusion_state(window).unwrap_or(0);
        let is_key: bool = msg_send![ns_window, isKeyWindow];
        let is_main: bool = msg_send![ns_window, isMainWindow];
        let is_visible: bool = msg_send![ns_window, isVisible];
        let is_miniaturized: bool = msg_send![ns_window, isMiniaturized];
        let content_view: *mut AnyObject = msg_send![ns_window, contentView];
        let mut content_hidden: Option<bool> = None;
        let mut content_alpha: Option<f64> = None;
        if !content_view.is_null() {
            let hidden: bool = msg_send![content_view, isHidden];
            let alpha: f64 = msg_send![content_view, alphaValue];
            content_hidden = Some(hidden);
            content_alpha = Some(alpha);
        }

        info!(
            "[main-window] native state context={} frame_x={} frame_y={} frame_width={} frame_height={} alpha={} level={} occlusion_state={} is_key={} is_main={} is_visible={} is_miniaturized={} content_hidden={:?} content_alpha={:?}",
            context,
            frame.origin.x,
            frame.origin.y,
            frame.size.width,
            frame.size.height,
            alpha,
            level,
            occlusion_state,
            is_key,
            is_main,
            is_visible,
            is_miniaturized,
            content_hidden,
            content_alpha
        );
    }
}

#[cfg(not(target_os = "macos"))]
fn log_main_window_native_state(_window: &tauri::WebviewWindow, _context: &str) {}

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
    log_main_window_native_state(window, context);
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

#[cfg(target_os = "macos")]
fn quiet_show_webview_window(window: &tauri::WebviewWindow, context: &str) {
    let Ok(ns_window) = window.ns_window() else {
        warn!(
            "[main-window] NSWindow unavailable during quiet show context={}",
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
        let _: () = msg_send![ns_window, orderFront: nil];
    }
    log_main_window_native_state(window, context);
    info!(
        "[main-window] quiet native window show context={} was_visible={:?} was_focused={:?} now_visible={:?} now_focused={:?}",
        context,
        was_visible,
        was_focused,
        window.is_visible().ok(),
        window.is_focused().ok()
    );
}

#[cfg(not(target_os = "macos"))]
fn quiet_show_webview_window(_window: &tauri::WebviewWindow, _context: &str) {}

fn schedule_main_window_visibility_probe(
    app: &tauri::AppHandle,
    delay: Duration,
    context: &'static str,
    presentation: MainWindowPresentation,
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
            present_webview_window(&window, presentation, context);
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

fn schedule_main_window_occlusion_recovery(
    app: &tauri::AppHandle,
    delay: Duration,
    context: &'static str,
) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        let app_for_probe = app.clone();
        let probe =
            run_main_window_step_on_main_thread(&app, "main window occlusion probe", move || {
                let Some(window) = live_main_window(&app_for_probe) else {
                    return Ok(None);
                };
                let occlusion_state = main_window_native_occlusion_state(&window);
                let is_occluded = main_window_native_is_occluded(&window).unwrap_or(false);
                Ok(Some((is_occluded, occlusion_state)))
            });

        let Ok(Some((true, occlusion_state))) = probe else {
            return;
        };

        warn!(
            "[main-window] native window stayed occluded after startup context={} delay_ms={} occlusion_state={:?}; recycling renderer",
            context,
            delay.as_millis(),
            occlusion_state
        );
        let _ = recover_main_window(&app, "startup native occlusion");
    });
}

fn create_main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, tauri::Error> {
    create_main_window_with_initial_visibility(app, true)
}

fn create_main_window_with_initial_visibility(
    app: &tauri::AppHandle,
    initially_visible: bool,
) -> Result<tauri::WebviewWindow, tauri::Error> {
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
    let builder = if initially_visible {
        builder
    } else {
        builder.visible(false).focused(false)
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

fn start_main_window_with_presentation(
    app: &tauri::AppHandle,
    presentation: MainWindowPresentation,
) -> Result<tauri::WebviewWindow, tauri::Error> {
    if let Some(window) = live_main_window(app) {
        present_webview_window(&window, presentation, "show-existing");
        return Ok(window);
    }

    if let Ok(data_dir) = app.path().app_data_dir() {
        std::fs::create_dir_all(&data_dir).ok();
        mark_startup_pending(&data_dir);
    }

    let window = create_main_window(app)?;
    present_webview_window(&window, presentation, "startup");
    schedule_main_window_visibility_probe(
        app,
        Duration::from_millis(250),
        "startup-250ms",
        presentation,
    );
    schedule_main_window_visibility_probe(app, Duration::from_secs(1), "startup-1s", presentation);
    schedule_main_window_visibility_probe(app, Duration::from_secs(3), "startup-3s", presentation);
    if presentation.should_recover_startup_occlusion() {
        schedule_main_window_occlusion_recovery(
            app,
            MAIN_WINDOW_OCCLUSION_RECOVERY_AFTER,
            "startup-occlusion",
        );
    } else {
        info!("[main-window] skipped startup occlusion recovery for quiet presentation");
    }
    let vibrancy_applied = apply_main_window_vibrancy(&window, "startup");
    info!(
        "[main-window] startup window ready vibrancy_applied={}",
        vibrancy_applied
    );
    Ok(window)
}

fn start_main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, tauri::Error> {
    start_main_window_with_presentation(app, MainWindowPresentation::Foreground)
}

fn start_main_window_quietly(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, tauri::Error> {
    start_main_window_with_presentation(app, MainWindowPresentation::Quiet)
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MainWindowRecoveryPresentation {
    RestoreIfVisible,
    KeepHidden,
}

fn recover_main_window(app: &tauri::AppHandle, reason: &str) -> Result<(), String> {
    recover_main_window_with_presentation(
        app,
        reason,
        MainWindowRecoveryPresentation::RestoreIfVisible,
    )
}

fn recover_main_window_hidden(app: &tauri::AppHandle, reason: &str) -> Result<(), String> {
    recover_main_window_with_presentation(app, reason, MainWindowRecoveryPresentation::KeepHidden)
}

fn recover_main_window_with_presentation(
    app: &tauri::AppHandle,
    reason: &str,
    presentation: MainWindowRecoveryPresentation,
) -> Result<(), String> {
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
                let restore_visible = match presentation {
                    MainWindowRecoveryPresentation::RestoreIfVisible => was_visible,
                    MainWindowRecoveryPresentation::KeepHidden => false,
                };
                rebuild_main_window_after_recovery(
                    &app_for_create,
                    &reason_for_create,
                    restore_visible,
                )
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
    let window = create_main_window_with_initial_visibility(app, was_visible)
        .map_err(|error| error.to_string())?;

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
fn should_show_primary_window_on_reopen(has_visible_windows: bool) -> bool {
    let _ = has_visible_windows;
    true
}

#[cfg(target_os = "macos")]
fn handle_macos_reopen(app: &tauri::AppHandle, has_visible_windows: bool) {
    info!(
        "[main-window] macOS reopen event has_visible_windows={} forcing_primary_window_show=true",
        has_visible_windows
    );

    if should_show_primary_window_on_reopen(has_visible_windows) {
        show_primary_window(app);
    }
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
    let undo_item = PredefinedMenuItem::undo(manager, None)?;
    let redo_item = PredefinedMenuItem::redo(manager, None)?;
    let edit_history_separator = PredefinedMenuItem::separator(manager)?;
    let cut_item = PredefinedMenuItem::cut(manager, None)?;
    let copy_item = PredefinedMenuItem::copy(manager, None)?;
    let paste_item = PredefinedMenuItem::paste(manager, None)?;
    let edit_selection_separator = PredefinedMenuItem::separator(manager)?;
    let select_all_item = PredefinedMenuItem::select_all(manager, None)?;
    let edit_menu = Submenu::with_items(
        manager,
        "Edit",
        true,
        &[
            &undo_item,
            &redo_item,
            &edit_history_separator,
            &cut_item,
            &copy_item,
            &paste_item,
            &edit_selection_separator,
            &select_all_item,
        ],
    )?;

    Menu::with_items(manager, &[&app_menu, &edit_menu])
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
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
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
            let dev_sync_result_data_dir = data_dir.clone();
            app.listen("dev-sync-trigger-native-result", move |event| {
                handle_dev_sync_trigger_result_event(&dev_sync_result_data_dir, event.payload());
            });
            start_dev_sync_trigger_watcher(app_handle.clone(), data_dir.clone());

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
                let _ = start_main_window_quietly(&app_handle)?;
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
            let fb_active_run_id: Arc<StdRwLock<Option<String>>> = Arc::new(StdRwLock::new(None));
            let fb_ids_clone = fb_unique_ids.clone();
            let fb_total_clone = fb_total_posts.clone();
            let fb_run_id_clone = fb_active_run_id.clone();

            let app_for_fb = app.handle().clone();
            app_for_fb.listen("fb-feed-data", move |event| {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                    let run_id = val.get("scrapeRunId")
                        .and_then(|s| s.as_str())
                        .unwrap_or("legacy")
                        .to_string();
                    {
                        let mut active_run_id = fb_run_id_clone.write().unwrap();
                        if active_run_id.as_deref() != Some(run_id.as_str()) {
                            *active_run_id = Some(run_id.clone());
                            fb_ids_clone.write().unwrap().clear();
                            fb_total_clone.store(0, Ordering::Relaxed);
                            info!("[FB] extraction run started: {}", run_id);
                        }
                    }
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
                        let strategy = val.get("strategy")
                            .and_then(|s| s.as_str())
                            .unwrap_or("?");
                        let page_state = val.get("pageState")
                            .and_then(|s| serde_json::to_string(s).ok())
                            .unwrap_or_else(|| "{}".to_string());
                        info!(
                            "[FB] extraction error: {} run_id={} strategy={} page_state={}",
                            error, run_id, strategy, page_state
                        );
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
                    info!("[FB] pass run_id={} @ scrollY={}: candidates={}, new={}, total_unique={}",
                        run_id, scroll_y, candidates, new_count, total);
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
                    let rejected = val.get("rejected").unwrap_or(&serde_json::Value::Null);
                    let rejected_suggested = rejected
                        .get("suggestedOrSponsored")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0);
                    let rejected_missing = rejected
                        .get("missingContent")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0);
                    let rejected_duplicate = rejected
                        .get("duplicate")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0);
                    let rejected_tiny = rejected
                        .get("tinyOrInvisible")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0);
                    let scroll_target = val.get("scrollTarget").unwrap_or(&serde_json::Value::Null);
                    let scroll_target_label = scroll_target
                        .get("target")
                        .and_then(|value| value.as_str())
                        .unwrap_or("?");
                    let scroll_target_after = scroll_target
                        .get("after")
                        .and_then(|value| value.as_f64())
                        .unwrap_or(0.0) as i64;
                    let scroll_target_movement = scroll_target
                        .get("movement")
                        .and_then(|value| value.as_f64())
                        .unwrap_or(0.0) as i64;
                    let scroll_candidate_count = scroll_target
                        .get("candidateCount")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0);
                    info!("[IG] pass @ scrollY={}: candidates={}, new={}, total_unique={}, strategy={}, rejected_suggested={}, rejected_missing={}, rejected_duplicate={}, rejected_tiny={}, scroll_target={}, scroll_after={}, scroll_movement={}, scroll_candidates={}, url={}",
                        scroll_y, candidates, new_count, total, strategy, rejected_suggested, rejected_missing, rejected_duplicate, rejected_tiny, scroll_target_label, scroll_target_after, scroll_target_movement, scroll_candidate_count, &url[..url.len().min(60)]);
                }
            });

            let renderer_health = Arc::new(StdRwLock::new(RendererHeartbeatStatus::new()));
            let renderer_memory_sample: Arc<StdMutex<Option<RendererMemorySample>>> =
                Arc::new(StdMutex::new(None));
            let renderer_health_for_listener = renderer_health.clone();
            let renderer_memory_sample_for_listener = renderer_memory_sample.clone();
            let renderer_health_for_memory_monitor = renderer_health.clone();
            let renderer_memory_sample_for_memory_monitor = renderer_memory_sample.clone();
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
                let (first_heartbeat, gap_ms, recovered, renderer_generation) = {
                    let mut health = renderer_health_for_listener.write().unwrap();
                    let (first_heartbeat, gap_ms, recovered) =
                        health.note_heartbeat(&payload, now);
                    (
                        first_heartbeat,
                        gap_ms,
                        recovered,
                        health.renderer_generation,
                    )
                };
                background_runtime_for_listener.note_renderer_heartbeat();

                let should_refresh_memory_sample = {
                    let sample = renderer_memory_sample_for_listener.lock().unwrap();
                    renderer_memory_sample_due(sample.as_ref().map(|sample| sample.sampled_at), now)
                };
                let refreshed_memory_sample = should_refresh_memory_sample.then(|| {
                    RendererMemorySample::from_stats(
                        now,
                        collect_runtime_memory_stats(&app_for_renderer_listener, 0, 0),
                    )
                });
                let memory_sample_refreshed = refreshed_memory_sample.is_some();
                let memory_health_fields = {
                    let mut sample = renderer_memory_sample_for_listener.lock().unwrap();
                    if let Some(refreshed_memory_sample) = refreshed_memory_sample {
                        *sample = Some(refreshed_memory_sample);
                    }
                    renderer_memory_health_fields(sample.as_ref(), now, memory_sample_refreshed)
                };

                let href = truncate_for_log(&payload.href, 120);
                let (active_job, active_job_age_ms) =
                    background_runtime_for_listener.active_job_for_health();
                let mut health_payload = serde_json::json!({
                        "event": "renderer_heartbeat",
                        "rendererGeneration": renderer_generation,
                        "seq": payload.seq,
                        "reason": payload.reason.clone(),
                        "visibility": payload.visibility.clone(),
                        "href": href.clone(),
                        "pageLoadId": payload.page_load_id.clone(),
                        "uptimeMs": payload.uptime_ms,
                        "appPhase": payload.app_phase.clone(),
                        "eventLoopLagMs": payload.event_loop_lag_ms,
                        "hiddenTimerThrottled": payload.hidden_timer_throttled,
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
                });
                if let Some(fields) = health_payload.as_object_mut() {
                    fields.extend(memory_health_fields);
                }
                append_runtime_health(&app_for_renderer_listener, health_payload);
                if recovered {
                    let _ = app_for_renderer_listener.emit(
                        "renderer-recovery-state",
                        serde_json::json!({
                            "phase": "recovered",
                            "reason": payload.reason.clone(),
                            "rendererGeneration": renderer_generation,
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

            let app_for_memory_monitor = app.handle().clone();
            let background_runtime_for_memory_monitor = app
                .state::<CaptureState>()
                .background_runtime
                .clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(RENDERER_HEARTBEAT_MEMORY_SAMPLE_INTERVAL).await;

                    let now = std::time::Instant::now();
                    let stats = collect_runtime_memory_stats(&app_for_memory_monitor, 0, 0);
                    let memory_health_fields = {
                        let mut sample = renderer_memory_sample_for_memory_monitor.lock().unwrap();
                        *sample = Some(RendererMemorySample::from_stats(now, stats.clone()));
                        renderer_memory_health_fields(sample.as_ref(), now, true)
                    };
                    let is_main_visible = app_for_memory_monitor
                        .get_webview_window(MAIN_WINDOW_LABEL)
                        .and_then(|window| window.is_visible().ok())
                        .unwrap_or(false);
                    let (active_job, active_job_age_ms) =
                        background_runtime_for_memory_monitor.active_job_for_health();
                    let (background_work_paused, background_pause_reason, background_pause_remaining_ms) =
                        background_runtime_for_memory_monitor.pause_status_for_health();
                    let (
                        safe_mode_active,
                        safe_mode_remaining_ms,
                        recoveries_short,
                        recoveries_long,
                    ) = background_runtime_for_memory_monitor.recovery_status_for_health();
                    let mut health_payload = {
                        let health = renderer_health_for_memory_monitor.read().unwrap();
                        let age_ms = health
                            .last_seen_at
                            .map(|last| now.duration_since(last).as_millis())
                            .unwrap_or_else(|| now.duration_since(health.started_at).as_millis());
                        serde_json::json!({
                            "event": "native_runtime_memory_sample",
                            "rendererGeneration": health.renderer_generation,
                            "ageMs": age_ms,
                            "visible": is_main_visible,
                            "lastSeq": health.last_seq,
                            "lastReason": health.last_reason.clone(),
                            "lastVisibility": health.last_visibility.clone(),
                            "href": truncate_for_log(&health.last_href, 120),
                            "pageLoadId": health.last_page_load_id.clone(),
                            "uptimeMs": health.last_uptime_ms,
                            "appPhase": health.last_app_phase.clone(),
                            "eventLoopLagMs": health.last_event_loop_lag_ms,
                            "hiddenTimerThrottled": renderer_health_hidden_timer_throttled(
                                !renderer_is_effectively_visible(is_main_visible, &health.last_visibility),
                                health.last_hidden_timer_throttled,
                            ),
                            "domNodeCount": health.last_dom_node_count,
                            "rendererHeapUsedBytes": health.last_renderer_heap_used_bytes,
                            "rendererHeapTotalBytes": health.last_renderer_heap_total_bytes,
                            "lastInputAgeMs": health.last_input_age_ms,
                            "settingsOpen": health.last_settings_open,
                            "dialogOpen": health.last_dialog_open,
                            "backgroundWorkPaused": background_work_paused,
                            "backgroundPauseReason": background_pause_reason,
                            "backgroundPauseRemainingMs": background_pause_remaining_ms,
                            "safeModeActive": safe_mode_active,
                            "safeModeRemainingMs": safe_mode_remaining_ms,
                            "recoveriesInShortWindow": recoveries_short,
                            "recoveriesInLongWindow": recoveries_long,
                            "activeBackgroundJob": active_job,
                            "activeBackgroundJobAgeMs": active_job_age_ms
                        })
                    };
                    if let Some(fields) = health_payload.as_object_mut() {
                        fields.extend(memory_health_fields);
                    }
                    append_runtime_health(&app_for_memory_monitor, health_payload);

                    let main_memory_recovery_reason = if active_job.is_none() {
                        main_renderer_memory_recovery_reason(
                            is_main_visible,
                            &renderer_health_for_memory_monitor
                                .read()
                                .unwrap()
                                .last_visibility,
                            &stats,
                        )
                    } else {
                        None
                    };
                    if let Some(main_memory_recovery_reason) = main_memory_recovery_reason {
                        let recovery = {
                            let mut health = renderer_health_for_memory_monitor.write().unwrap();
                            let recent_recovery_count = health
                                .recent_recovery_count(BACKGROUND_SAFE_MODE_RECOVERY_WINDOW_SHORT);
                            let recovery_threshold = renderer_recovery_threshold_for_count(
                                is_main_visible,
                                &health.last_visibility,
                                recent_recovery_count,
                            );
                            let cooldown_elapsed = health
                                .last_recovery_at
                                .map(|last| last.elapsed() > recovery_threshold)
                                .unwrap_or(true);
                            if cooldown_elapsed {
                                let attempt = health.note_recovery_attempt(std::time::Instant::now());
                                let last_visibility = health.last_visibility.clone();
                                let recover_hidden =
                                    !renderer_is_effectively_visible(is_main_visible, &last_visibility);
                                Some((
                                    attempt,
                                    health.renderer_generation,
                                    last_visibility,
                                    health.last_page_load_id.clone(),
                                    health.last_app_phase.clone(),
                                    main_memory_recovery_reason,
                                    recovery_threshold,
                                    recover_hidden,
                                ))
                            } else {
                                None
                            }
                        };

                        if let Some((
                            attempt,
                            renderer_generation,
                            last_visibility,
                            page_load_id,
                            app_phase,
                            main_memory_recovery_reason,
                            recovery_threshold,
                            recover_hidden,
                        )) = recovery
                        {
                            let reason = match main_memory_recovery_reason {
                                "webkit_resident_tail" => "main renderer WebKit resident tail high",
                                "idle_webkit_resident_tail" => {
                                    "idle main renderer WebKit resident tail high"
                                }
                                "idle_webkit_footprint_pressure" => {
                                    "idle main renderer WebKit memory high"
                                }
                                _ => "main renderer WebKit memory high",
                            };
                            background_runtime_for_memory_monitor.note_renderer_recovery_attempt(reason);
                            let (
                                safe_mode_active,
                                safe_mode_remaining_ms,
                                recoveries_short,
                                recoveries_long,
                            ) = background_runtime_for_memory_monitor.recovery_status_for_health();
                            append_runtime_health(
                                &app_for_memory_monitor,
                                serde_json::json!({
                                    "event": "renderer_recovery_attempt",
                                    "reason": reason,
                                    "memoryRecoveryReason": main_memory_recovery_reason,
                                    "rendererGeneration": renderer_generation,
                                    "attempt": attempt,
                                    "thresholdMs": recovery_threshold.as_millis(),
                                    "visible": is_main_visible,
                                    "lastVisibility": last_visibility,
                                    "pageLoadId": page_load_id,
                                    "appPhase": app_phase,
                                    "rendererRecoveryAllowed": true,
                                    "recoverHidden": recover_hidden,
                                    "appMemoryPressureBytes": stats.app_memory_pressure_bytes,
                                    "appResidentBytes": stats.app_resident_bytes,
                                    "nativeResidentBytes": stats.process_resident_bytes,
                                    "nativeFootprintBytes": stats.process_footprint_bytes,
                                    "webkitFootprintBytes": stats.webkit_total_footprint_bytes,
                                    "webkitResidentBytes": stats.webkit_total_resident_bytes,
                                    "webkitLargestProcessId": stats.webkit_largest_process_id,
                                    "webkitLargestFootprintBytes": stats.webkit_largest_footprint_bytes,
                                    "webkitLargestResidentBytes": stats.webkit_largest_resident_bytes,
                                    "webkitLargestCpuUsage": stats.webkit_largest_cpu_usage,
                                    "webkitLargestAgeSeconds": stats.webkit_largest_age_seconds,
                                    "webkitLargestRole": stats.webkit_largest_role,
                                    "webkitResidentRecoveryBytes": POST_SOCIAL_SCRAPE_WEBKIT_RESIDENT_RECOVERY_BYTES,
                                    "webkitResidentTailReclaimable": webkit_resident_tail_is_probably_reclaimable(&stats),
                                    "webkitProcessCount": stats.webkit_process_count,
                                    "memoryHighBytes": stats.memory_high_bytes,
                                    "memoryCriticalBytes": stats.memory_critical_bytes,
                                    "safeModeActive": safe_mode_active,
                                    "safeModeRemainingMs": safe_mode_remaining_ms,
                                    "recoveriesInShortWindow": recoveries_short,
                                    "recoveriesInLongWindow": recoveries_long
                                }),
                            );
                            capture_deep_runtime_diagnostic(
                                &app_for_memory_monitor,
                                "renderer_memory_recovery_attempt",
                                reason,
                                &stats,
                                None,
                                None,
                                true,
                            );
                            warn!(
                                "[main-window] recovering renderer for memory attempt={} app_pressure={} app_rss={} webkit_pressure={} webkit_rss={} threshold_ms={} safe_mode={}",
                                attempt,
                                format_bytes_for_log(stats.app_memory_pressure_bytes),
                                format_bytes_for_log(stats.app_resident_bytes),
                                format_bytes_for_log(
                                    stats
                                        .webkit_largest_footprint_bytes
                                        .unwrap_or_else(|| stats.webkit_largest_resident_bytes.unwrap_or(0))
                                ),
                                format_bytes_for_log(stats.webkit_total_resident_bytes),
                                recovery_threshold.as_millis(),
                                safe_mode_active
                            );
                            recycle_social_scraper_windows_unless_active(
                                &app_for_memory_monitor,
                                &background_runtime_for_memory_monitor,
                                reason,
                            );
                            let recovery_result = if recover_hidden {
                                recover_main_window_hidden(&app_for_memory_monitor, reason)
                            } else {
                                recover_main_window(&app_for_memory_monitor, reason)
                            };
                            if let Err(error) = recovery_result {
                                error!(
                                    "[main-window] memory recovery failed reason={} error={}",
                                    reason, error
                                );
                            }
                        }
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

                    let main_window_state = app_for_renderer_watchdog
                        .get_webview_window(MAIN_WINDOW_LABEL)
                        .map(|window| {
                            (
                                window.is_visible().ok().unwrap_or(false),
                                window.is_focused().ok().unwrap_or(false),
                            )
                        })
                        .unwrap_or((false, false));
                    let (is_main_visible, is_main_focused) = main_window_state;

                    let (should_recycle_scrapers, should_recover_main) = {
                        let mut health = renderer_health_for_watchdog.write().unwrap();
                        let age = health
                            .last_seen_at
                            .map(|last| last.elapsed())
                            .unwrap_or_else(|| health.started_at.elapsed());
                        let policy_last_visibility = renderer_watchdog_last_visibility_for_policy(
                            is_main_visible,
                            is_main_focused,
                            &health.last_visibility,
                        )
                        .to_string();
                        let is_effectively_visible = renderer_watchdog_treats_as_visible(
                            is_main_visible,
                            is_main_focused,
                            &health.last_visibility,
                        );

                        let recent_recovery_count =
                            health.recent_recovery_count(BACKGROUND_SAFE_MODE_RECOVERY_WINDOW_SHORT);
                        let recovery_threshold = renderer_recovery_threshold_for_count(
                            is_main_visible,
                            &policy_last_visibility,
                            recent_recovery_count,
                        );
                        let stale_log_after =
                            renderer_stale_log_after(is_main_visible, &policy_last_visibility);
                        let recovery_allowed = renderer_stale_should_recover(
                            is_main_visible,
                            &policy_last_visibility,
                        );
                        let lag_recovery_allowed = renderer_event_loop_lag_should_recover(
                            is_main_visible,
                            &policy_last_visibility,
                            health.last_event_loop_lag_ms,
                        );
                        let recovery_reason = if lag_recovery_allowed {
                            "renderer event loop lag high"
                        } else {
                            "renderer heartbeat stale"
                        };
                        let expected_hidden_throttle = renderer_gap_is_expected_hidden_throttle(
                            is_main_visible,
                            &policy_last_visibility,
                            health.last_hidden_timer_throttled,
                            age,
                            recovery_threshold,
                        );
                        let should_log_gap = age > stale_log_after
                            && !health.stale_logged
                            && (!health.throttle_logged || !expected_hidden_throttle);
                        let should_log_throttle = should_log_gap && expected_hidden_throttle;
                        let should_log_stale = should_log_gap && !expected_hidden_throttle;
                        let should_recover =
                            recovery_allowed &&
                            (age > recovery_threshold || lag_recovery_allowed) &&
                            health
                                .last_recovery_at
                                .map(|last| last.elapsed() > recovery_threshold)
                                .unwrap_or(true);
                        let mut should_recycle_background_scrapers = false;

                        if should_log_throttle {
                            let stats = collect_runtime_memory_stats(&app_for_renderer_watchdog, 0, 0);
                            info!(
                                "[main-window] renderer heartbeat hidden-timer throttled age_ms={} threshold_ms={} visible={} focused={} effective_visible={} last_seq={} last_reason={} last_visibility={} href={} native_rss={}",
                                age.as_millis(),
                                recovery_threshold.as_millis(),
                                is_main_visible,
                                is_main_focused,
                                is_effectively_visible,
                                health.last_seq,
                                health.last_reason,
                                health.last_visibility,
                                truncate_for_log(&health.last_href, 120),
                                format_bytes_for_log(stats.process_resident_bytes)
                            );
                            health.throttle_logged = true;
                            let (active_job, active_job_age_ms) =
                                background_runtime_for_watchdog.active_job_for_health();
                            append_runtime_health(
                                &app_for_renderer_watchdog,
                                serde_json::json!({
                                    "event": "renderer_heartbeat_throttled",
                                    "rendererGeneration": health.renderer_generation,
                                    "ageMs": age.as_millis(),
                                    "thresholdMs": recovery_threshold.as_millis(),
                                    "visible": is_main_visible,
                                    "focused": is_main_focused,
                                    "effectiveVisible": is_effectively_visible,
                                    "policyLastVisibility": policy_last_visibility.clone(),
                                    "lastSeq": health.last_seq,
                                    "lastReason": health.last_reason.clone(),
                                    "lastVisibility": health.last_visibility.clone(),
                                    "href": truncate_for_log(&health.last_href, 120),
                                    "pageLoadId": health.last_page_load_id.clone(),
                                    "uptimeMs": health.last_uptime_ms,
                                    "appPhase": health.last_app_phase.clone(),
                                    "hiddenTimerThrottled": renderer_health_hidden_timer_throttled(
                                        expected_hidden_throttle,
                                        health.last_hidden_timer_throttled,
                                    ),
                                    "rendererRecoveryAllowed": recovery_allowed,
                                    "backgroundWorkPaused": false,
                                    "deepDiagnosticCaptured": false,
                                    "nativeResidentBytes": stats.process_resident_bytes,
                                    "webkitResidentBytes": stats.webkit_total_resident_bytes,
                                    "webkitLargestProcessId": stats.webkit_largest_process_id,
                                    "webkitLargestResidentBytes": stats.webkit_largest_resident_bytes,
                                    "webkitLargestCpuUsage": stats.webkit_largest_cpu_usage,
                                    "webkitLargestAgeSeconds": stats.webkit_largest_age_seconds,
                                    "webkitLargestRole": stats.webkit_largest_role,
                                    "webkitProcessCount": stats.webkit_process_count,
                                    "activeBackgroundJob": active_job,
                                    "activeBackgroundJobAgeMs": active_job_age_ms
                                }),
                            );
                        }

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
                                "[main-window] renderer heartbeat stale age_ms={} threshold_ms={} visible={} focused={} effective_visible={} recovery_allowed={} last_seq={} last_reason={} last_visibility={} href={} native_rss={} {}",
                                age.as_millis(),
                                recovery_threshold.as_millis(),
                                is_main_visible,
                                is_main_focused,
                                is_effectively_visible,
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
                                    &policy_last_visibility,
                                );
                            let capture_deep_diagnostic =
                                renderer_stale_log_should_capture_deep_diagnostic(
                                    is_main_visible,
                                    &policy_last_visibility,
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
                                    "focused": is_main_focused,
                                    "effectiveVisible": is_effectively_visible,
                                    "lastSeq": health.last_seq,
                                    "lastReason": health.last_reason.clone(),
                                    "lastVisibility": health.last_visibility.clone(),
                                    "href": truncate_for_log(&health.last_href, 120),
                                    "pageLoadId": health.last_page_load_id.clone(),
                                    "uptimeMs": health.last_uptime_ms,
                                    "appPhase": health.last_app_phase.clone(),
                                    "eventLoopLagMs": health.last_event_loop_lag_ms,
                                    "hiddenTimerThrottled": health.last_hidden_timer_throttled,
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
                                    "focused": is_main_focused,
                                    "effectiveVisible": is_effectively_visible,
                                    "policyLastVisibility": policy_last_visibility.clone(),
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
                            let recovery_last_visibility = health.last_visibility.clone();
                            let recovery_event_loop_lag_ms = health.last_event_loop_lag_ms;
                            let recovery_renderer_generation =
                                health.renderer_generation.saturating_add(1);
                            let attempt = health.note_recovery_attempt(std::time::Instant::now());
                            background_runtime_for_watchdog
                                .note_renderer_recovery_attempt(recovery_reason);
                            let stats = collect_runtime_memory_stats(&app_for_renderer_watchdog, 0, 0);
                            let (active_job, active_job_age_ms) =
                                background_runtime_for_watchdog.active_job_for_health();
                            let (safe_mode_active, safe_mode_remaining_ms, recoveries_short, recoveries_long) =
                                background_runtime_for_watchdog.recovery_status_for_health();
                            append_runtime_health(
                                &app_for_renderer_watchdog,
                                serde_json::json!({
                                    "event": "renderer_recovery_attempt",
                                    "rendererGeneration": recovery_renderer_generation,
                                    "attempt": attempt,
                                    "ageMs": age.as_millis(),
                                    "reason": recovery_reason,
                                    "thresholdMs": recovery_threshold.as_millis(),
                                    "visible": is_main_visible,
                                    "focused": is_main_focused,
                                    "effectiveVisible": is_effectively_visible,
                                    "policyLastVisibility": policy_last_visibility.clone(),
                                    "lastVisibility": recovery_last_visibility.clone(),
                                    "rendererRecoveryAllowed": recovery_allowed,
                                    "eventLoopLagMs": recovery_event_loop_lag_ms,
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
                                    "reason": recovery_reason,
                                    "rendererGeneration": recovery_renderer_generation,
                                    "attempt": attempt,
                                    "ageMs": age.as_millis(),
                                    "thresholdMs": recovery_threshold.as_millis(),
                                    "lastVisibility": recovery_last_visibility,
                                    "focused": is_main_focused,
                                    "effectiveVisible": is_effectively_visible,
                                    "policyLastVisibility": policy_last_visibility,
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
                                recovery_reason,
                                &stats,
                                active_job,
                                active_job_age_ms,
                                true,
                            );
                            warn!(
                                "[main-window] recovering renderer attempt={} reason={} age_ms={} event_loop_lag_ms={} threshold_ms={} visible={} focused={} effective_visible={} safe_mode={}",
                                attempt,
                                recovery_reason,
                                age.as_millis(),
                                recovery_event_loop_lag_ms.unwrap_or(0.0),
                                recovery_threshold.as_millis(),
                                is_main_visible,
                                is_main_focused,
                                is_effectively_visible,
                                safe_mode_active
                            );
                        }

                        (should_recycle_background_scrapers || should_recover, should_recover)
                    };

                    if should_recycle_scrapers {
                        recycle_social_scraper_windows_unless_active(
                            &app_for_renderer_watchdog,
                            &background_runtime_for_watchdog,
                            "main renderer heartbeat stale",
                        );
                    }

                    if should_recover_main {
                        if let Err(error) = recover_main_window(
                            &app_for_renderer_watchdog,
                            "renderer watchdog recovery",
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
                            recycle_social_scraper_windows_unless_active(
                                &app_for_renderer_watchdog,
                                &background_runtime_for_watchdog,
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
            export_startup_diagnostics,
            fetch_url,
            google_api_request,
            google_oauth_proxy_request,
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
            get_desktop_session_state,
            get_social_provider_cookie_state,
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
            fb_check_group_membership,
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
        .build(tauri::generate_context!())
        .expect("error while building Freed")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                handle_macos_reopen(app, has_visible_windows);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn main_window_presentation_focus_contract_is_explicit() {
        assert!(MainWindowPresentation::Foreground.should_focus());
        assert!(!MainWindowPresentation::Quiet.should_focus());
        assert!(MainWindowPresentation::Foreground.should_recover_startup_occlusion());
        assert!(!MainWindowPresentation::Quiet.should_recover_startup_occlusion());
    }

    fn make_runtime_memory_stats_for_test(
        app_resident_bytes: u64,
        app_memory_pressure_bytes: u64,
    ) -> RuntimeMemoryStats {
        RuntimeMemoryStats {
            total_physical_memory_bytes: 64 * BYTES_PER_GIB,
            process_resident_bytes: 128,
            process_footprint_bytes: Some(128),
            process_virtual_bytes: 256,
            app_resident_bytes,
            app_memory_pressure_bytes,
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
            webkit_attribution_precise: true,
            indexed_db_bytes: None,
            webkit_cache_bytes: None,
            storage_sizes_sampled: true,
            sample_duration_ms: 0,
            memory_high_bytes: MAX_CRITICAL_MEMORY_BYTES * 70 / 100,
            memory_critical_bytes: MAX_CRITICAL_MEMORY_BYTES,
            relay_doc_bytes: 0,
            relay_client_count: 0,
        }
    }

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
    fn social_feed_scroll_script_uses_measured_container_scrolls() {
        let script = social_feed_scroll_script(420);

        assert!(script.contains("requestedDelta = Number(420)"));
        assert!(script.contains("minimumUsefulMovement"));
        assert!(script.contains("document.scrollingElement"));
        assert!(script.contains("[role='feed']"));
        assert!(script.contains("[data-pagelet*='Feed']"));
        assert!(script.contains("selectScrollers"));
        assert!(script.contains("tryScrollAt"));
        assert!(script.contains("target.scrollTo"));
        assert!(script.contains("behavior: \"auto\""));
        assert!(!script.contains("behavior: 'smooth'"));
        assert!(!script.contains("behavior: \"smooth\""));
        assert!(!script.contains("WheelEvent"));
        assert!(!script.contains("MouseEvent"));
        assert!(!script.contains("dispatchEvent(new Event(\"scroll\""));
        assert!(!script.contains("dispatchEvent(new Event('scroll'"));
    }

    #[test]
    fn social_feed_scroll_script_supports_backscroll() {
        let script = social_feed_scroll_script(-180);

        assert!(script.contains("requestedDelta = Number(-180)"));
        assert!(script.contains("direction = requestedDelta >= 0 ? 1 : -1"));
        assert!(script.contains("clamp(after + requestedDelta"));
    }

    #[test]
    fn instagram_feed_ready_does_not_require_readable_session_cookie() {
        let state = IgFeedStatePayload {
            logged_in_cookie: false,
            article_count: 3,
            ready_article_count: 3,
            tiny_article_count: 0,
            first_article_height: 612,
            first_article_text_length: 120,
            first_article_media_count: 1,
            scroll_height: 2589,
            document_ready_state: "complete".to_string(),
            login_chrome: false,
            main_found: true,
            url: "https://www.instagram.com/?variant=following".to_string(),
            title: "Instagram".to_string(),
        };

        assert!(state.feed_ready());
        assert!(!IgFeedStatePayload {
            ready_article_count: 0,
            tiny_article_count: 2,
            article_count: 2,
            ..state.clone()
        }
        .feed_ready());
        assert!(IgFeedStatePayload {
            ready_article_count: 0,
            tiny_article_count: 2,
            article_count: 2,
            first_article_height: 56,
            first_article_text_length: 0,
            first_article_media_count: 0,
            scroll_height: 1199,
            ..state
        }
        .placeholders_only());
    }

    #[test]
    fn facebook_page_state_requires_real_feed_evidence() {
        let tall_logged_out_shell = FbPageStatePayload {
            logged_in_cookie: false,
            scroll_height: 3200,
            feed_posts_heading_count: 0,
            feed_unit_count: 0,
            login_chrome: true,
            role_main_count: 1,
            url: "https://www.facebook.com/".to_string(),
            title: "Facebook".to_string(),
        };
        assert!(!tall_logged_out_shell.feed_like());

        let rendered_feed_with_hidden_cookie = FbPageStatePayload {
            logged_in_cookie: false,
            scroll_height: 3200,
            feed_posts_heading_count: 0,
            feed_unit_count: 2,
            login_chrome: false,
            role_main_count: 1,
            url: "https://www.facebook.com/".to_string(),
            title: "Facebook".to_string(),
        };
        assert!(rendered_feed_with_hidden_cookie.feed_like());

        let cookie_session_without_rendered_units = FbPageStatePayload {
            logged_in_cookie: true,
            scroll_height: 900,
            feed_posts_heading_count: 0,
            feed_unit_count: 0,
            login_chrome: false,
            role_main_count: 1,
            url: "https://www.facebook.com/".to_string(),
            title: "Facebook".to_string(),
        };
        assert!(cookie_session_without_rendered_units.feed_like());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn parses_macos_screen_lock_state_from_ioreg_plist() {
        assert_eq!(
            parse_screen_locked_from_ioreg_plist(
                r#"<dict><key>CGSSessionScreenIsLocked</key><true/></dict>"#,
            ),
            Some(true),
        );
        assert_eq!(
            parse_screen_locked_from_ioreg_plist(
                r#"<dict><key>CGSSessionScreenIsLocked</key><false/></dict>"#,
            ),
            Some(false),
        );
        assert_eq!(parse_screen_locked_from_ioreg_plist("<dict></dict>"), None);
    }

    fn binary_cookie_record(name: &str) -> Vec<u8> {
        let domain = b".facebook.com\0";
        let mut name_bytes = name.as_bytes().to_vec();
        name_bytes.push(0);
        let path = b"/\0";
        let cookie_value = b"redacted\0";
        let strings_start = 48usize;
        let domain_offset = strings_start;
        let name_offset = domain_offset + domain.len();
        let path_offset = name_offset + name_bytes.len();
        let value_offset = path_offset + path.len();
        let size = value_offset + cookie_value.len();
        let mut record = vec![0u8; strings_start];
        record[0..4].copy_from_slice(&(size as u32).to_le_bytes());
        record[16..20].copy_from_slice(&(domain_offset as u32).to_le_bytes());
        record[20..24].copy_from_slice(&(name_offset as u32).to_le_bytes());
        record[24..28].copy_from_slice(&(path_offset as u32).to_le_bytes());
        record[28..32].copy_from_slice(&(value_offset as u32).to_le_bytes());
        record.extend_from_slice(domain);
        record.extend_from_slice(&name_bytes);
        record.extend_from_slice(path);
        record.extend_from_slice(cookie_value);
        record
    }

    fn binary_cookie_store(names: &[&str]) -> Vec<u8> {
        let mut page = vec![0u8; 8 + names.len() * 4];
        page[4..8].copy_from_slice(&(names.len() as u32).to_le_bytes());
        for (index, name) in names.iter().enumerate() {
            let record_offset = page.len();
            page[8 + index * 4..12 + index * 4]
                .copy_from_slice(&(record_offset as u32).to_le_bytes());
            page.extend_from_slice(&binary_cookie_record(name));
        }

        let mut data = Vec::new();
        data.extend_from_slice(b"cook");
        data.extend_from_slice(&1u32.to_be_bytes());
        data.extend_from_slice(&(page.len() as u32).to_be_bytes());
        data.extend_from_slice(&page);
        data
    }

    #[test]
    fn social_cookie_parser_reads_names_without_values() {
        let parsed = parse_webkit_binary_cookie_names(&binary_cookie_store(&["datr", "c_user"]))
            .expect("cookie store should parse");

        assert_eq!(parsed, vec!["c_user".to_string(), "datr".to_string()]);
    }

    #[test]
    fn data_store_identifier_folder_matches_webkit_directory_names() {
        assert_eq!(
            data_store_identifier_folder(FB_SCRAPER_DATA_STORE_IDENTIFIER),
            "66726565-64fb-0001-9a7d-370102fb0001"
        );
        assert_eq!(
            data_store_identifier_folder(IG_SCRAPER_DATA_STORE_IDENTIFIER),
            "66726565-641a-0002-9a7d-3701021a0002"
        );
        assert_eq!(
            data_store_identifier_folder(LI_SCRAPER_DATA_STORE_IDENTIFIER),
            "66726565-641d-0003-9a7d-3701021d0003"
        );
    }

    #[test]
    fn dev_sync_trigger_request_parses_supported_provider() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            dev_sync_trigger_path(temp.path()),
            r#"{"enabled":true,"id":"facebook-123","provider":"facebook","createdAt":123456}"#,
        )
        .unwrap();

        let request = load_dev_sync_trigger_request(temp.path()).unwrap();

        assert_eq!(request.enabled, Some(true));
        assert_eq!(request.id.as_deref(), Some("facebook-123"));
        assert_eq!(request.provider.as_deref(), Some("facebook"));
        assert_eq!(request.created_at, Some(123456));
        assert!(is_supported_dev_sync_provider("facebook"));
        assert!(!is_supported_dev_sync_provider("medium"));
    }

    #[test]
    fn dev_sync_trigger_request_expiration_blocks_stale_or_malformed_requests() {
        let fresh = DevSyncTriggerRequest {
            enabled: Some(true),
            id: Some("facebook-fresh".to_string()),
            provider: Some("facebook".to_string()),
            created_at: Some(1_000),
        };
        assert_eq!(
            dev_sync_trigger_request_expiration_detail(&fresh, 1_000),
            None
        );

        let expired = DevSyncTriggerRequest {
            enabled: Some(true),
            id: Some("facebook-expired".to_string()),
            provider: Some("facebook".to_string()),
            created_at: Some(1_000),
        };
        assert_eq!(
            dev_sync_trigger_request_expiration_detail(
                &expired,
                1_000 + DEV_SYNC_TRIGGER_REQUEST_MAX_AGE_MS + 1,
            ),
            Some("Trigger request expired before Freed Desktop picked it up. Re-run scripts/dev-sync-trigger.mjs.")
        );

        let missing = DevSyncTriggerRequest {
            enabled: Some(true),
            id: Some("facebook-missing".to_string()),
            provider: Some("facebook".to_string()),
            created_at: None,
        };
        assert_eq!(
            dev_sync_trigger_request_expiration_detail(&missing, 1_000),
            Some("Trigger request is missing createdAt. Re-run scripts/dev-sync-trigger.mjs.")
        );
    }

    #[test]
    fn dev_sync_trigger_result_uses_terminal_helper_shape() {
        let temp = tempfile::tempdir().unwrap();

        write_dev_sync_trigger_result(
            temp.path(),
            "instagram-456",
            Some("instagram"),
            "completed",
            None,
        );

        let raw = std::fs::read_to_string(dev_sync_trigger_result_path(temp.path())).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed["id"], serde_json::json!("instagram-456"));
        assert_eq!(parsed["provider"], serde_json::json!("instagram"));
        assert_eq!(parsed["status"], serde_json::json!("completed"));
        assert!(parsed.get("updatedAt").is_some());
        assert!(is_dev_sync_trigger_terminal_status("completed"));
        assert!(!is_dev_sync_trigger_terminal_status("started"));
    }

    #[test]
    fn dev_sync_trigger_stale_results_do_not_replace_current_result() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            dev_sync_trigger_path(temp.path()),
            r#"{"enabled":true,"id":"facebook-new","provider":"facebook"}"#,
        )
        .unwrap();

        write_dev_sync_trigger_result(
            temp.path(),
            "facebook-new",
            Some("facebook"),
            "started",
            None,
        );

        assert!(!write_current_dev_sync_trigger_result(
            temp.path(),
            "facebook-old",
            Some("facebook"),
            "error",
            Some("Old renderer timeout."),
        ));

        let raw = std::fs::read_to_string(dev_sync_trigger_result_path(temp.path())).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed["id"], serde_json::json!("facebook-new"));
        assert_eq!(parsed["status"], serde_json::json!("started"));

        assert!(write_current_dev_sync_trigger_result(
            temp.path(),
            "facebook-new",
            Some("facebook"),
            "completed",
            Some("Current request finished."),
        ));

        let raw = std::fs::read_to_string(dev_sync_trigger_result_path(temp.path())).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed["id"], serde_json::json!("facebook-new"));
        assert_eq!(parsed["status"], serde_json::json!("completed"));
        assert_eq!(
            parsed["detail"],
            serde_json::json!("Current request finished.")
        );
    }

    #[test]
    fn renderer_memory_sample_due_respects_throttle() {
        let now = std::time::Instant::now();

        assert!(renderer_memory_sample_due(None, now));
        assert!(!renderer_memory_sample_due(
            Some(now),
            now + RENDERER_HEARTBEAT_MEMORY_SAMPLE_INTERVAL - Duration::from_secs(1)
        ));
        assert!(renderer_memory_sample_due(
            Some(now),
            now + RENDERER_HEARTBEAT_MEMORY_SAMPLE_INTERVAL
        ));
    }

    #[test]
    fn renderer_memory_health_fields_include_app_scoped_webkit_stats() {
        let now = std::time::Instant::now();
        let stats = RuntimeMemoryStats {
            total_physical_memory_bytes: 16 * BYTES_PER_GIB,
            process_resident_bytes: 101,
            process_footprint_bytes: Some(102),
            process_virtual_bytes: 103,
            app_resident_bytes: 201,
            app_memory_pressure_bytes: 202,
            webkit_resident_bytes: Some(301),
            webkit_footprint_bytes: Some(302),
            webkit_virtual_bytes: Some(303),
            webkit_process_id: Some(42),
            webkit_total_resident_bytes: 401,
            webkit_total_footprint_bytes: Some(402),
            webkit_process_count: 2,
            webkit_largest_resident_bytes: Some(501),
            webkit_largest_footprint_bytes: Some(502),
            webkit_largest_process_id: Some(43),
            webkit_largest_cpu_usage: Some(1.5),
            webkit_largest_age_seconds: Some(9),
            webkit_largest_role: Some("freed-webcontent".to_string()),
            webkit_processes: Vec::new(),
            webkit_telemetry_available: true,
            webkit_attribution_precise: true,
            indexed_db_bytes: None,
            webkit_cache_bytes: None,
            storage_sizes_sampled: true,
            sample_duration_ms: 0,
            memory_high_bytes: 601,
            memory_critical_bytes: 602,
            relay_doc_bytes: 0,
            relay_client_count: 0,
        };
        let sample = RendererMemorySample::from_stats(now - Duration::from_secs(2), stats);
        let fields = renderer_memory_health_fields(Some(&sample), now, true);

        assert_eq!(
            fields["nativeMemorySampleRefreshed"],
            serde_json::json!(true)
        );
        assert_eq!(fields["nativeMemorySampleAgeMs"].as_u64(), Some(2000));
        assert_eq!(fields["nativeResidentBytes"], serde_json::json!(101));
        assert_eq!(fields["nativeFootprintBytes"], serde_json::json!(102));
        assert_eq!(fields["appResidentBytes"], serde_json::json!(201));
        assert_eq!(fields["appMemoryPressureBytes"], serde_json::json!(202));
        assert_eq!(fields["webkitResidentBytes"], serde_json::json!(401));
        assert_eq!(fields["webkitFootprintBytes"], serde_json::json!(402));
        assert_eq!(fields["webkitLargestProcessId"], serde_json::json!(43));
        assert_eq!(fields["webkitLargestResidentBytes"], serde_json::json!(501));
        assert_eq!(
            fields["webkitLargestFootprintBytes"],
            serde_json::json!(502)
        );
        assert_eq!(fields["webkitProcessCount"], serde_json::json!(2));
        assert_eq!(fields["webkitTelemetryAvailable"], serde_json::json!(true));
        assert_eq!(fields["memoryHighBytes"], serde_json::json!(601));
        assert_eq!(fields["memoryCriticalBytes"], serde_json::json!(602));
    }

    #[test]
    fn background_runtime_requires_stable_renderer_before_jobs() {
        let runtime = BackgroundRuntimeCoordinator::new();
        assert!(runtime.begin_job("fb_scrape_feed").is_err());
        assert_eq!(
            runtime.pause_status_for_health(),
            (true, Some("waiting_for_renderer_heartbeats"), None)
        );

        runtime.note_renderer_heartbeat();
        assert!(runtime.begin_job("fb_scrape_feed").is_err());
        assert_eq!(
            runtime.pause_status_for_health(),
            (true, Some("waiting_for_renderer_heartbeats"), None)
        );

        runtime.note_renderer_heartbeat();
        assert_eq!(runtime.pause_status_for_health(), (false, None, None));
        assert!(runtime.begin_job("fb_scrape_feed").is_ok());
        assert!(runtime.begin_job("ig_scrape_feed").is_err());
        assert!(runtime.finish_job("fb_scrape_feed").is_some());
    }

    #[test]
    fn active_social_scraper_jobs_defer_recovery_recycling() {
        assert!(active_job_uses_social_scraper(Some("fb_scrape_feed")));
        assert!(active_job_uses_social_scraper(Some("ig_scrape_feed")));
        assert!(active_job_uses_social_scraper(Some("li_scrape_feed")));
        assert!(active_job_uses_social_scraper(Some("fb_visit_url")));
        assert!(!active_job_uses_social_scraper(Some("cloud_sync")));
        assert!(!active_job_uses_social_scraper(None));
    }

    #[test]
    fn background_runtime_resumes_after_healthy_recovery_heartbeats() {
        let runtime = BackgroundRuntimeCoordinator::new();
        runtime.note_renderer_heartbeat();
        runtime.note_renderer_heartbeat();
        assert!(runtime.begin_job("fb_scrape_feed").is_ok());
        let _ = runtime.finish_job("fb_scrape_feed");

        runtime.note_renderer_stale("test stale renderer");
        let (paused, reason, remaining_ms) = runtime.pause_status_for_health();
        assert!(paused);
        assert_eq!(reason, Some("renderer_stale"));
        assert!(remaining_ms.unwrap_or(0) > 0);

        let err = runtime.begin_job("ig_scrape_feed").unwrap_err();
        assert!(err.contains("renderer is stale") || err.contains("cooling down"));

        runtime.note_renderer_heartbeat();
        runtime.note_renderer_heartbeat();
        let (paused, reason, remaining_ms) = runtime.pause_status_for_health();
        assert!(!paused);
        assert_eq!(reason, None);
        assert_eq!(remaining_ms, None);
        assert!(runtime.begin_job("ig_scrape_feed").is_ok());
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
        let (paused, reason, remaining_ms) = runtime.pause_status_for_health();
        assert!(paused);
        assert_eq!(reason, Some("memory_pressure_cooldown"));
        assert!(remaining_ms.unwrap_or(0) > 0);

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
    fn startup_recovery_retry_rearms_pending_boot_without_preserving_failure_count() {
        let temp = tempfile::tempdir().unwrap();
        save_startup_recovery_state(
            temp.path(),
            &StartupRecoveryState {
                consecutive_failed_boots: 2,
                pending_boot_started_at_ms: None,
                last_failed_boot_at_ms: Some(123),
                last_successful_boot_at_ms: Some(100),
            },
        );

        prepare_startup_recovery_retry(temp.path());

        let state = load_startup_recovery_state(temp.path());
        assert_eq!(state.consecutive_failed_boots, 0);
        assert!(state.pending_boot_started_at_ms.is_some());
        assert_eq!(state.last_failed_boot_at_ms, Some(123));
    }

    #[test]
    fn startup_diagnostics_bundle_includes_recovery_and_runtime_tail() {
        let data_dir = tempfile::tempdir().unwrap();
        let downloads_dir = tempfile::tempdir().unwrap();
        save_startup_recovery_state(
            data_dir.path(),
            &StartupRecoveryState {
                consecutive_failed_boots: 1,
                pending_boot_started_at_ms: None,
                last_failed_boot_at_ms: Some(123),
                last_successful_boot_at_ms: Some(100),
            },
        );
        std::fs::write(runtime_health_path(data_dir.path()), "old\nnew\n").unwrap();
        std::fs::write(
            runtime_diagnostics_path(data_dir.path()),
            "{\"event\":\"deep\"}\n",
        )
        .unwrap();
        std::fs::write(
            data_dir.path().join("sync-health.json"),
            "{\"healthy\":false}",
        )
        .unwrap();

        let output_path = write_startup_diagnostics_bundle(
            data_dir.path(),
            downloads_dir.path(),
            "26.6.901",
            "macos",
        )
        .unwrap();

        let raw = std::fs::read_to_string(output_path).unwrap();
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(json["version"], "26.6.901");
        assert_eq!(json["platform"], "macos");
        assert_eq!(json["startupRecovery"]["consecutive_failed_boots"], 1);
        assert!(json["runtimeHealth"].as_str().unwrap().contains("new"));
        assert!(json["runtimeDiagnostics"]
            .as_str()
            .unwrap()
            .contains("deep"));
        assert!(json["syncHealth"].as_str().unwrap().contains("healthy"));
    }

    #[test]
    fn bounded_jsonl_retains_tail_when_file_exceeds_budget() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("runtime-health.jsonl");
        std::fs::write(
            &path,
            [
                "old-0", "old-1", "old-2", "old-3", "old-4", "old-5", "old-6", "old-7", "old-8",
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
            social_scraper_data_store_identifier("fb-login"),
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

        assert!(webkit_process_started_after_app_start(0, app_age));
        assert!(webkit_process_started_after_app_start(
            app_age + WEBKIT_PROCESS_START_GRACE_SECONDS,
            app_age
        ));
        assert!(!webkit_process_started_after_app_start(
            app_age + WEBKIT_PROCESS_START_GRACE_SECONDS + 1,
            app_age
        ));

        assert!(webkit_process_started_with_app(app_age, app_age));
        assert!(webkit_process_started_with_app(
            app_age.saturating_sub(WEBKIT_PROCESS_START_GRACE_SECONDS),
            app_age
        ));
        assert!(!webkit_process_started_with_app(0, app_age));
    }

    #[test]
    fn webkit_process_role_counts_rooted_current_launches() {
        let app_age = 60;

        assert_eq!(
            freed_webkit_process_role(true, app_age, app_age),
            Some("freed-webcontent")
        );
        assert_eq!(
            freed_webkit_process_role(true, 0, app_age),
            Some("freed-webcontent")
        );
        assert_eq!(
            freed_webkit_process_role(
                true,
                app_age + WEBKIT_PROCESS_START_GRACE_SECONDS + 1,
                app_age
            ),
            None
        );
    }

    #[test]
    fn webkit_process_role_keeps_only_app_start_rootless_processes() {
        let app_age = 60;

        assert_eq!(
            freed_webkit_process_role(false, app_age, app_age),
            Some("freed-webcontent-age-matched")
        );
        assert_eq!(
            freed_webkit_process_role(
                false,
                app_age.saturating_sub(WEBKIT_PROCESS_START_GRACE_SECONDS),
                app_age
            ),
            Some("freed-webcontent-age-matched")
        );
        assert_eq!(freed_webkit_process_role(false, 0, app_age), None);
        assert_eq!(
            freed_webkit_process_role(
                false,
                app_age + WEBKIT_PROCESS_START_GRACE_SECONDS + 1,
                app_age
            ),
            None
        );
    }

    fn webkit_process_stats(process_id: u32, resident_bytes: u64) -> WebkitProcessRuntimeStats {
        WebkitProcessRuntimeStats {
            process_id,
            resident_bytes,
            footprint_bytes: Some(resident_bytes),
            virtual_bytes: resident_bytes.saturating_mul(2),
            cpu_usage: 0.0,
            age_seconds: 10,
            role: "freed-webcontent".to_string(),
        }
    }

    #[test]
    fn scraper_recycle_verification_records_exited_retained_and_new_webkit_pids() {
        let before = vec![
            webkit_process_stats(10, 900),
            webkit_process_stats(20, 700),
            webkit_process_stats(30, 500),
        ];
        let after = vec![webkit_process_stats(20, 650), webkit_process_stats(40, 200)];

        let verification =
            scraper_recycle_verification_from_processes(&before, 2_100, &after, 850, 742);

        assert_eq!(verification.before_process_ids, vec![10, 20, 30]);
        assert_eq!(verification.after_process_ids, vec![20, 40]);
        assert_eq!(verification.exited_process_ids, vec![10, 30]);
        assert_eq!(verification.retained_process_ids, vec![20]);
        assert_eq!(verification.new_process_ids, vec![40]);
        assert_eq!(verification.webkit_resident_delta_bytes, 1_250);
        assert_eq!(verification.elapsed_ms, 742);
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
            webkit_attribution_precise: true,
            indexed_db_bytes: None,
            webkit_cache_bytes: None,
            storage_sizes_sampled: true,
            sample_duration_ms: 0,
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
    fn scrape_memory_allows_reclaimable_webkit_rss_tail_below_critical_pressure() {
        let budget =
            (MIN_CRITICAL_MEMORY_BYTES * 70 / 100).saturating_sub(SCRAPE_MEMORY_HEADROOM_BYTES);
        let stats = RuntimeMemoryStats {
            total_physical_memory_bytes: 16 * BYTES_PER_GIB,
            process_resident_bytes: 128,
            process_footprint_bytes: Some(128),
            process_virtual_bytes: 256,
            app_resident_bytes: budget - 1,
            app_memory_pressure_bytes: budget - 1,
            webkit_resident_bytes: Some(budget - 1),
            webkit_footprint_bytes: Some(512 * 1024 * 1024),
            webkit_virtual_bytes: None,
            webkit_process_id: Some(123),
            webkit_total_resident_bytes: budget - 1,
            webkit_total_footprint_bytes: Some(512 * 1024 * 1024),
            webkit_process_count: 1,
            webkit_largest_resident_bytes: Some(budget - 1),
            webkit_largest_footprint_bytes: Some(512 * 1024 * 1024),
            webkit_largest_process_id: Some(123),
            webkit_largest_cpu_usage: Some(0.0),
            webkit_largest_age_seconds: Some(10),
            webkit_largest_role: Some("freed-webcontent".to_string()),
            webkit_processes: Vec::new(),
            webkit_telemetry_available: true,
            webkit_attribution_precise: true,
            indexed_db_bytes: None,
            webkit_cache_bytes: None,
            storage_sizes_sampled: true,
            sample_duration_ms: 0,
            memory_high_bytes: MIN_CRITICAL_MEMORY_BYTES * 70 / 100,
            memory_critical_bytes: MIN_CRITICAL_MEMORY_BYTES,
            relay_doc_bytes: 0,
            relay_client_count: 0,
        };

        assert!(scrape_memory_may_proceed(&stats));
        let high_resident_stats = RuntimeMemoryStats {
            app_resident_bytes: budget,
            app_memory_pressure_bytes: budget - 1,
            ..stats
        };
        assert!(webkit_resident_tail_is_probably_reclaimable(
            &high_resident_stats
        ));
        assert!(scrape_memory_may_proceed(&high_resident_stats));
        assert_eq!(scrape_memory_pressure_level(&high_resident_stats), "normal");
        assert_eq!(
            social_scrape_plan_for_memory(&high_resident_stats, 6, 10),
            SocialScrapePlan {
                min_passes: 2,
                max_passes: 3,
                skip_stories: true,
                reason: "minimal-memory-margin",
            }
        );
    }

    #[test]
    fn scrape_memory_blocks_high_resident_bytes_without_webkit_footprint_telemetry() {
        let budget =
            (MIN_CRITICAL_MEMORY_BYTES * 70 / 100).saturating_sub(SCRAPE_MEMORY_HEADROOM_BYTES);
        let stats = RuntimeMemoryStats {
            total_physical_memory_bytes: 16 * BYTES_PER_GIB,
            process_resident_bytes: 128,
            process_footprint_bytes: Some(128),
            process_virtual_bytes: 256,
            app_resident_bytes: budget,
            app_memory_pressure_bytes: budget - 1,
            webkit_resident_bytes: Some(budget - 1),
            webkit_footprint_bytes: None,
            webkit_virtual_bytes: None,
            webkit_process_id: Some(123),
            webkit_total_resident_bytes: budget - 1,
            webkit_total_footprint_bytes: None,
            webkit_process_count: 1,
            webkit_largest_resident_bytes: Some(budget - 1),
            webkit_largest_footprint_bytes: None,
            webkit_largest_process_id: Some(123),
            webkit_largest_cpu_usage: Some(0.0),
            webkit_largest_age_seconds: Some(10),
            webkit_largest_role: Some("freed-webcontent".to_string()),
            webkit_processes: Vec::new(),
            webkit_telemetry_available: false,
            webkit_attribution_precise: true,
            indexed_db_bytes: None,
            webkit_cache_bytes: None,
            storage_sizes_sampled: true,
            sample_duration_ms: 0,
            memory_high_bytes: MIN_CRITICAL_MEMORY_BYTES * 70 / 100,
            memory_critical_bytes: MIN_CRITICAL_MEMORY_BYTES,
            relay_doc_bytes: 0,
            relay_client_count: 0,
        };

        assert!(!scrape_memory_may_proceed(&stats));
        assert_eq!(scrape_memory_pressure_level(&stats), "high");
    }

    #[test]
    fn scrape_memory_blocks_high_resident_bytes_even_when_footprint_is_low() {
        let stats = RuntimeMemoryStats {
            total_physical_memory_bytes: 16 * BYTES_PER_GIB,
            process_resident_bytes: 128,
            process_footprint_bytes: Some(128),
            process_virtual_bytes: 256,
            app_resident_bytes: MIN_CRITICAL_MEMORY_BYTES
                .saturating_sub(SCRAPE_MEMORY_HEADROOM_BYTES),
            app_memory_pressure_bytes: 512 * 1024 * 1024,
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
            webkit_attribution_precise: true,
            indexed_db_bytes: None,
            webkit_cache_bytes: None,
            storage_sizes_sampled: true,
            sample_duration_ms: 0,
            memory_high_bytes: MIN_CRITICAL_MEMORY_BYTES * 70 / 100,
            memory_critical_bytes: MIN_CRITICAL_MEMORY_BYTES,
            relay_doc_bytes: 0,
            relay_client_count: 0,
        };

        assert!(!scrape_memory_may_proceed(&stats));
        assert_eq!(scrape_memory_pressure_level(&stats), "high");
        assert_eq!(
            scrape_memory_pressure_level(&RuntimeMemoryStats {
                app_resident_bytes: MIN_CRITICAL_MEMORY_BYTES,
                ..stats
            }),
            "critical"
        );
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
            webkit_attribution_precise: true,
            indexed_db_bytes: None,
            webkit_cache_bytes: None,
            storage_sizes_sampled: true,
            sample_duration_ms: 0,
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
        let make_stats = |app_resident_bytes, app_memory_pressure_bytes| RuntimeMemoryStats {
            total_physical_memory_bytes: 16 * BYTES_PER_GIB,
            process_resident_bytes: 128,
            process_footprint_bytes: Some(128),
            process_virtual_bytes: 256,
            app_resident_bytes,
            app_memory_pressure_bytes,
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
            webkit_attribution_precise: true,
            indexed_db_bytes: None,
            webkit_cache_bytes: None,
            storage_sizes_sampled: true,
            sample_duration_ms: 0,
            memory_high_bytes: MIN_CRITICAL_MEMORY_BYTES * 70 / 100,
            memory_critical_bytes: MIN_CRITICAL_MEMORY_BYTES,
            relay_doc_bytes: 0,
            relay_client_count: 0,
        };
        let story_budget_bytes = optional_story_memory_budget_bytes(&make_stats(0, 0));
        let stats = make_stats(
            story_budget_bytes.saturating_sub(1),
            story_budget_bytes.saturating_sub(1),
        );

        assert!(optional_story_scrape_may_proceed(&stats));
        assert!(!optional_story_scrape_may_proceed(&make_stats(
            story_budget_bytes,
            story_budget_bytes,
        )));
        assert!(!optional_story_scrape_may_proceed(&make_stats(
            story_budget_bytes,
            story_budget_bytes.saturating_sub(1),
        )));
    }

    #[test]
    fn social_scrape_plan_keeps_full_passes_when_memory_has_room() {
        let stats = make_runtime_memory_stats_for_test(512 * 1024 * 1024, 512 * 1024 * 1024);
        let plan = social_scrape_plan_for_memory(&stats, 6, 10);

        assert_eq!(
            plan,
            SocialScrapePlan {
                min_passes: 6,
                max_passes: 10,
                skip_stories: false,
                reason: "full",
            }
        );
    }

    #[test]
    fn social_scrape_plan_skips_stories_when_story_budget_is_tight() {
        let mut stats = make_runtime_memory_stats_for_test(0, 0);
        let story_budget_bytes = optional_story_memory_budget_bytes(&stats);
        stats.app_resident_bytes = story_budget_bytes;
        stats.app_memory_pressure_bytes = story_budget_bytes;

        let plan = social_scrape_plan_for_memory(&stats, 6, 10);

        assert_eq!(
            plan,
            SocialScrapePlan {
                min_passes: 3,
                max_passes: 5,
                skip_stories: true,
                reason: "feed-only-memory-budget",
            }
        );
    }

    #[test]
    fn social_scrape_plan_reduces_passes_near_start_budget() {
        let mut stats = make_runtime_memory_stats_for_test(0, 0);
        let near_budget = scrape_memory_start_budget_bytes(&stats)
            .saturating_sub(SCRAPE_REDUCED_PASS_MARGIN_BYTES);
        stats.app_resident_bytes = near_budget;
        stats.app_memory_pressure_bytes = near_budget;

        let plan = social_scrape_plan_for_memory(&stats, 6, 10);

        assert_eq!(
            plan,
            SocialScrapePlan {
                min_passes: 3,
                max_passes: 5,
                skip_stories: true,
                reason: "reduced-memory-margin",
            }
        );
    }

    #[test]
    fn social_scrape_plan_uses_minimal_passes_at_low_margin() {
        let mut stats = make_runtime_memory_stats_for_test(0, 0);
        let near_budget = scrape_memory_start_budget_bytes(&stats)
            .saturating_sub(SCRAPE_MINIMAL_PASS_MARGIN_BYTES);
        stats.app_resident_bytes = near_budget;
        stats.app_memory_pressure_bytes = near_budget;

        let plan = social_scrape_plan_for_memory(&stats, 5, 9);

        assert_eq!(
            plan,
            SocialScrapePlan {
                min_passes: 2,
                max_passes: 3,
                skip_stories: true,
                reason: "minimal-memory-margin",
            }
        );
    }

    fn runtime_stats_with_webkit(
        app_resident_bytes: u64,
        app_memory_pressure_bytes: u64,
        webkit_resident_bytes: u64,
        webkit_footprint_bytes: Option<u64>,
    ) -> RuntimeMemoryStats {
        RuntimeMemoryStats {
            app_resident_bytes,
            app_memory_pressure_bytes,
            webkit_resident_bytes: Some(webkit_resident_bytes),
            webkit_footprint_bytes,
            webkit_process_id: Some(321),
            webkit_total_resident_bytes: webkit_resident_bytes,
            webkit_total_footprint_bytes: webkit_footprint_bytes,
            webkit_process_count: 1,
            webkit_largest_resident_bytes: Some(webkit_resident_bytes),
            webkit_largest_footprint_bytes: webkit_footprint_bytes,
            webkit_largest_process_id: Some(321),
            webkit_largest_cpu_usage: Some(0.0),
            webkit_largest_age_seconds: Some(60),
            webkit_largest_role: Some("freed-webcontent".to_string()),
            webkit_telemetry_available: webkit_footprint_bytes.is_some(),
            ..make_runtime_memory_stats_for_test(app_resident_bytes, app_memory_pressure_bytes)
        }
    }

    #[test]
    fn post_social_scrape_recovery_triggers_on_large_webkit_footprint_growth() {
        let before = runtime_stats_with_webkit(
            900 * 1024 * 1024,
            800 * 1024 * 1024,
            900 * 1024 * 1024,
            Some(700 * 1024 * 1024),
        );
        let after = runtime_stats_with_webkit(
            6 * BYTES_PER_GIB,
            3 * BYTES_PER_GIB,
            6 * BYTES_PER_GIB,
            Some(3 * BYTES_PER_GIB),
        );

        assert_eq!(
            post_social_scrape_memory_recovery_reason(&before, &after),
            Some("webkit_footprint_growth")
        );
    }

    #[test]
    fn post_social_scrape_recovery_triggers_on_sustained_webkit_pressure() {
        let before = runtime_stats_with_webkit(
            3 * BYTES_PER_GIB,
            2 * BYTES_PER_GIB,
            3 * BYTES_PER_GIB,
            Some(2300 * 1024 * 1024),
        );
        let after = runtime_stats_with_webkit(
            6 * BYTES_PER_GIB,
            4 * BYTES_PER_GIB,
            6 * BYTES_PER_GIB,
            Some(2600 * 1024 * 1024),
        );

        assert_eq!(
            post_social_scrape_memory_recovery_reason(&before, &after),
            Some("webkit_footprint_pressure")
        );
    }

    #[test]
    fn post_social_scrape_recovery_ignores_reclaimable_resident_tail() {
        let before = runtime_stats_with_webkit(
            800 * 1024 * 1024,
            700 * 1024 * 1024,
            800 * 1024 * 1024,
            Some(512 * 1024 * 1024),
        );
        let after = runtime_stats_with_webkit(
            3 * BYTES_PER_GIB,
            1200 * 1024 * 1024,
            3 * BYTES_PER_GIB,
            Some(512 * 1024 * 1024),
        );

        assert!(webkit_resident_tail_is_probably_reclaimable(&after));
        assert_eq!(
            post_social_scrape_memory_recovery_reason(&before, &after),
            None
        );
    }

    #[test]
    fn post_social_scrape_recovery_triggers_on_huge_reclaimable_resident_tail() {
        let before = runtime_stats_with_webkit(
            800 * 1024 * 1024,
            700 * 1024 * 1024,
            800 * 1024 * 1024,
            Some(512 * 1024 * 1024),
        );
        let after = runtime_stats_with_webkit(
            7 * BYTES_PER_GIB,
            1200 * 1024 * 1024,
            7 * BYTES_PER_GIB,
            Some(512 * 1024 * 1024),
        );

        assert!(webkit_resident_tail_is_probably_reclaimable(&after));
        assert_eq!(
            post_social_scrape_memory_recovery_reason(&before, &after),
            Some("webkit_resident_tail")
        );
    }

    #[test]
    fn post_social_scrape_recovery_waits_below_threshold() {
        let before = runtime_stats_with_webkit(
            800 * 1024 * 1024,
            700 * 1024 * 1024,
            800 * 1024 * 1024,
            Some(700 * 1024 * 1024),
        );
        let after = runtime_stats_with_webkit(
            1600 * 1024 * 1024,
            1300 * 1024 * 1024,
            1600 * 1024 * 1024,
            Some(1500 * 1024 * 1024),
        );

        assert_eq!(
            post_social_scrape_memory_recovery_reason(&before, &after),
            None
        );
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

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_reopen_always_reasserts_primary_window() {
        assert!(should_show_primary_window_on_reopen(false));
        assert!(should_show_primary_window_on_reopen(true));
    }
}
