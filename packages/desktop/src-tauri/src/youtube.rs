use serde::{Deserialize, Serialize};
use std::sync::{Arc, LazyLock, Mutex};
use tauri::webview::PageLoadEvent;
use tauri::{Emitter, Listener, Manager};
use tokio::sync::{oneshot, Notify};
use tokio::time::{sleep_until, timeout, timeout_at, Duration, Instant};
use url::Url;

const YOUTUBE_SESSION_WINDOW_LABEL: &str = "youtube-session";
const YOUTUBE_SUBSCRIPTIONS_URL: &str = "https://www.youtube.com/feed/subscriptions";
const YOUTUBE_CHANNELS_URL: &str = "https://www.youtube.com/feed/channels";
const YOUTUBE_CAPTURE_SCRIPT: &str = include_str!("youtube-extract.js");
const YOUTUBE_PLAYLIST_ACTION_SCRIPT: &str = include_str!("youtube-playlist-action.js");
const YOUTUBE_CAPTURE_QUEUE_TIMEOUT: Duration = Duration::from_secs(70);
const YOUTUBE_CAPTURE_OVERALL_TIMEOUT: Duration = Duration::from_secs(190);
const YOUTUBE_CAPTURE_STAGE_TIMEOUT: Duration = Duration::from_secs(70);
const YOUTUBE_CAPTURE_NAVIGATION_TIMEOUT: Duration = Duration::from_secs(20);
const YOUTUBE_SESSION_DATA_STORE_IDENTIFIER: [u8; 16] = [
    0x66, 0x72, 0x65, 0x65, 0x64, 0x79, 0x74, 0x01, 0x9a, 0x7d, 0x37, 0x01, 0x02, 0x79, 0x74, 0x01,
];
const YOUTUBE_AUTH_OBSERVER_SCRIPT: &str = r#"
(function () {
  "use strict";

  function authEvidence() {
    if (!location.hostname.endsWith("youtube.com")) return null;
    if (window.ytcfg && typeof window.ytcfg.get === "function") {
      var configured = window.ytcfg.get("LOGGED_IN");
      if (typeof configured === "boolean") return configured;
    }
    var context = window.ytInitialData && window.ytInitialData.responseContext;
    var loggedOut = context && context.mainAppWebResponseContext
      && context.mainAppWebResponseContext.loggedOut;
    if (typeof loggedOut === "boolean") return !loggedOut;
    if (document.querySelector(
      "ytd-topbar-menu-button-renderer #avatar-btn, button#avatar-btn, [aria-label^='Account menu']"
    )) return true;
    if (document.querySelector(
      "ytd-button-renderer a[href*='accounts.google.com/ServiceLogin'], a[href*='accounts.google.com/ServiceLogin']"
    )) return false;
    return null;
  }

  function emitEvidence() {
    try {
      var loggedIn = authEvidence();
      if (loggedIn === null) return;
      if (window.__TAURI__ && window.__TAURI__.event) {
        window.__TAURI__.event.emit("yt-auth-result", { loggedIn: loggedIn });
      }
    } catch (error) {
      if (window.__TAURI__ && window.__TAURI__.event) {
        window.__TAURI__.event.emit("yt-auth-result", {
          loggedIn: false,
          error: error && error.message ? error.message : String(error)
        });
      }
    }
  }

  window.addEventListener("DOMContentLoaded", function () {
    window.setTimeout(emitEvidence, 500);
    window.setTimeout(emitEvidence, 1800);
  });
  document.addEventListener("yt-page-data-updated", function () {
    window.setTimeout(emitEvidence, 250);
  });
  document.addEventListener("yt-navigate-finish", function () {
    window.setTimeout(emitEvidence, 250);
  });
  window.setTimeout(emitEvidence, 2500);
})();
"#;
const YOUTUBE_AUTH_PROBE_SCRIPT: &str = r#"
(function () {
  "use strict";
  var startedAt = Date.now();
  function evidence() {
    if (!location.hostname.endsWith("youtube.com")) return null;
    if (window.ytcfg && typeof window.ytcfg.get === "function") {
      var configured = window.ytcfg.get("LOGGED_IN");
      if (typeof configured === "boolean") return configured;
    }
    var context = window.ytInitialData && window.ytInitialData.responseContext;
    var loggedOut = context && context.mainAppWebResponseContext
      && context.mainAppWebResponseContext.loggedOut;
    if (typeof loggedOut === "boolean") return !loggedOut;
    if (document.querySelector(
      "ytd-topbar-menu-button-renderer #avatar-btn, button#avatar-btn, [aria-label^='Account menu']"
    )) return true;
    if (document.querySelector(
      "ytd-button-renderer a[href*='accounts.google.com/ServiceLogin'], a[href*='accounts.google.com/ServiceLogin']"
    )) return false;
    return null;
  }
  function check() {
    try {
      var loggedIn = evidence();
      if (loggedIn !== null) {
        window.__TAURI__.event.emit("yt-auth-result", { loggedIn: loggedIn });
        return;
      }
      if (Date.now() - startedAt >= 10000) {
        window.__TAURI__.event.emit("yt-auth-result", {
          loggedIn: false,
          error: "YouTube authentication evidence did not render."
        });
        return;
      }
      window.setTimeout(check, 250);
    } catch (error) {
      window.__TAURI__.event.emit("yt-auth-result", {
        loggedIn: false,
        error: error && error.message ? error.message : String(error)
      });
    }
  }
  check();
})();
"#;

static YOUTUBE_SESSION_OPERATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static YOUTUBE_PAGE_LOAD_STATE: LazyLock<Mutex<YouTubePageLoadState>> =
    LazyLock::new(|| Mutex::new(YouTubePageLoadState::default()));
static YOUTUBE_PAGE_LOAD_NOTIFY: LazyLock<Notify> = LazyLock::new(Notify::new);
static YOUTUBE_ACTIVE_CAPTURE: LazyLock<Mutex<Option<YouTubeActiveCapture>>> =
    LazyLock::new(|| Mutex::new(None));
static YOUTUBE_CAPTURE_CANCEL_NOTIFY: LazyLock<Notify> = LazyLock::new(Notify::new);
static YOUTUBE_CAPTURE_FINISHED_NOTIFY: LazyLock<Notify> = LazyLock::new(Notify::new);

#[derive(Clone, Debug, Eq, PartialEq)]
struct YouTubeNavigationAttemptToken {
    webview_generation: u64,
    attempt_id: u64,
    expected_path: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct YouTubeNavigationAttemptState {
    token: YouTubeNavigationAttemptToken,
    started: bool,
    finished: bool,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct YouTubePageLoadState {
    next_webview_generation: u64,
    current_webview_generation: Option<u64>,
    next_attempt_id: u64,
    active_attempt: Option<YouTubeNavigationAttemptState>,
}

impl YouTubePageLoadState {
    fn reserve_webview_generation(&mut self) -> u64 {
        self.next_webview_generation = self.next_webview_generation.saturating_add(1);
        let generation = self.next_webview_generation;
        self.current_webview_generation = Some(generation);
        self.active_attempt = None;
        generation
    }

    fn current_webview_generation(&self) -> Result<u64, String> {
        self.current_webview_generation
            .ok_or_else(|| "YouTube session window generation is unavailable.".to_string())
    }

    fn begin_navigation_attempt(
        &mut self,
        expected_path: &str,
    ) -> Result<YouTubeNavigationAttemptToken, String> {
        let webview_generation = self.current_webview_generation()?;
        self.next_attempt_id = self.next_attempt_id.saturating_add(1);
        let token = YouTubeNavigationAttemptToken {
            webview_generation,
            attempt_id: self.next_attempt_id,
            expected_path: expected_path.to_string(),
        };
        self.active_attempt = Some(YouTubeNavigationAttemptState {
            token: token.clone(),
            started: false,
            finished: false,
        });
        Ok(token)
    }

    fn record_page_load(
        &mut self,
        webview_generation: u64,
        url: &Url,
        event: PageLoadEvent,
    ) -> bool {
        if self.current_webview_generation != Some(webview_generation) {
            return false;
        }
        let Some(attempt) = self.active_attempt.as_mut() else {
            return false;
        };
        if attempt.token.webview_generation != webview_generation
            || !youtube_url_matches_path(url, &attempt.token.expected_path)
        {
            return false;
        }
        match event {
            PageLoadEvent::Started => {
                attempt.started = true;
                attempt.finished = false;
                true
            }
            PageLoadEvent::Finished if attempt.started => {
                attempt.finished = true;
                true
            }
            PageLoadEvent::Finished => false,
        }
    }

    fn navigation_attempt_finished(&self, token: &YouTubeNavigationAttemptToken) -> bool {
        self.active_attempt
            .as_ref()
            .is_some_and(|attempt| attempt.token == *token && attempt.started && attempt.finished)
    }

    fn clear_navigation_attempt(&mut self, token: &YouTubeNavigationAttemptToken) {
        if self
            .active_attempt
            .as_ref()
            .is_some_and(|attempt| attempt.token == *token)
        {
            self.active_attempt = None;
        }
    }

    fn retire_webview_generation(&mut self, webview_generation: u64) {
        if self.current_webview_generation == Some(webview_generation) {
            self.current_webview_generation = None;
            self.active_attempt = None;
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct YouTubeActiveCapture {
    capture_id: String,
    cancelled: bool,
    session_claimed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum YouTubeWindowPresentation {
    Interactive,
    Hidden,
}

impl YouTubeWindowPresentation {
    fn from_interactive(interactive: bool) -> Self {
        if interactive {
            Self::Interactive
        } else {
            Self::Hidden
        }
    }
}

trait YouTubeWindowControls {
    fn set_youtube_always_on_bottom(&self, always_on_bottom: bool);
    fn set_youtube_focusable(&self, focusable: bool);
    fn show_youtube_window(&self) -> Result<(), String>;
    fn hide_youtube_window(&self) -> Result<(), String>;
    fn focus_youtube_window(&self);
}

impl<R: tauri::Runtime> YouTubeWindowControls for tauri::WebviewWindow<R> {
    fn set_youtube_always_on_bottom(&self, always_on_bottom: bool) {
        let _ = self.set_always_on_bottom(always_on_bottom);
    }

    fn set_youtube_focusable(&self, focusable: bool) {
        let _ = self.set_focusable(focusable);
    }

    fn show_youtube_window(&self) -> Result<(), String> {
        self.show().map_err(|error| error.to_string())
    }

    fn hide_youtube_window(&self) -> Result<(), String> {
        self.hide().map_err(|error| error.to_string())
    }

    fn focus_youtube_window(&self) {
        let _ = self.set_focus();
    }
}

fn apply_youtube_window_presentation(
    window: &impl YouTubeWindowControls,
    presentation: YouTubeWindowPresentation,
) -> Result<(), String> {
    match presentation {
        YouTubeWindowPresentation::Interactive => {
            window.set_youtube_always_on_bottom(false);
            window.set_youtube_focusable(true);
            window.show_youtube_window()?;
            window.focus_youtube_window();
        }
        YouTubeWindowPresentation::Hidden => {
            window.set_youtube_always_on_bottom(true);
            window.set_youtube_focusable(false);
            window.hide_youtube_window()?;
        }
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YouTubeAuthPayload {
    logged_in: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct YouTubeCapturePayload {
    capture_id: Option<String>,
    stage: Option<String>,
    done: Option<bool>,
    error: Option<String>,
    roster_complete: Option<bool>,
    complete: Option<bool>,
    channel_total: Option<u64>,
    video_total: Option<u64>,
    candidate_count: Option<u64>,
    unresolved_count: Option<u64>,
    scroll_passes: Option<u64>,
    stop_reason: Option<String>,
    page_evidence: Option<bool>,
    explicit_empty: Option<bool>,
    unsupported_candidate_count: Option<u64>,
    pending_continuation: Option<bool>,
    work_budget_exceeded: Option<bool>,
    deadline_exceeded: Option<bool>,
    #[serde(default)]
    channels: Vec<serde_json::Value>,
    #[serde(default)]
    videos: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeCaptureResult {
    stages: Vec<YouTubeCapturePayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YouTubePlaylistPayload {
    video_id: Option<String>,
    result: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum YouTubeCaptureEventDisposition {
    Ignore,
    Progress,
    Complete,
    Error,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum YouTubeCaptureCancellation {
    NoMatch,
    Queued,
    SessionActive,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum YouTubeDataRetention {
    Preserve,
    ClearForDisconnect,
}

impl YouTubeDataRetention {
    fn clears_browsing_data(self) -> bool {
        self == Self::ClearForDisconnect
    }

    fn scrubs_before_destroy(self) -> bool {
        self == Self::Preserve
    }
}

struct YouTubeCaptureGuard {
    capture_id: String,
}

struct YouTubeListenerGuard {
    app: tauri::AppHandle,
    listener_id: Option<tauri::EventId>,
}

impl YouTubeListenerGuard {
    fn new(app: &tauri::AppHandle, listener_id: tauri::EventId) -> Self {
        Self {
            app: app.clone(),
            listener_id: Some(listener_id),
        }
    }
}

impl Drop for YouTubeListenerGuard {
    fn drop(&mut self) {
        if let Some(listener_id) = self.listener_id.take() {
            self.app.unlisten(listener_id);
        }
    }
}

impl YouTubeCaptureGuard {
    fn begin(capture_id: &str) -> Result<Self, String> {
        if capture_id.trim().is_empty() {
            return Err("YouTube capture ID is required.".to_string());
        }

        let mut active = YOUTUBE_ACTIVE_CAPTURE.lock().unwrap();
        if active.is_some() {
            return Err("Another YouTube capture is already active.".to_string());
        }
        *active = Some(YouTubeActiveCapture {
            capture_id: capture_id.to_string(),
            cancelled: false,
            session_claimed: false,
        });
        Ok(Self {
            capture_id: capture_id.to_string(),
        })
    }
}

impl Drop for YouTubeCaptureGuard {
    fn drop(&mut self) {
        let mut active = YOUTUBE_ACTIVE_CAPTURE.lock().unwrap();
        if active
            .as_ref()
            .is_some_and(|capture| capture.capture_id == self.capture_id)
        {
            *active = None;
        }
        drop(active);
        YOUTUBE_CAPTURE_FINISHED_NOTIFY.notify_waiters();
    }
}

fn youtube_capture_path(stage: &str) -> Result<&'static str, String> {
    match stage {
        "channels" => Ok("/feed/channels"),
        "subscriptions" => Ok("/feed/subscriptions"),
        _ => Err("Unsupported YouTube capture stage.".to_string()),
    }
}

fn reserve_youtube_webview_generation() -> u64 {
    YOUTUBE_PAGE_LOAD_STATE
        .lock()
        .unwrap()
        .reserve_webview_generation()
}

fn current_youtube_webview_generation() -> Result<u64, String> {
    YOUTUBE_PAGE_LOAD_STATE
        .lock()
        .unwrap()
        .current_webview_generation()
}

fn retire_youtube_webview_generation(webview_generation: u64) {
    YOUTUBE_PAGE_LOAD_STATE
        .lock()
        .unwrap()
        .retire_webview_generation(webview_generation);
}

fn begin_youtube_navigation_attempt(
    expected_path: &str,
) -> Result<YouTubeNavigationAttemptToken, String> {
    YOUTUBE_PAGE_LOAD_STATE
        .lock()
        .unwrap()
        .begin_navigation_attempt(expected_path)
}

fn record_youtube_page_load(webview_generation: u64, url: &Url, event: PageLoadEvent) {
    let mut state = YOUTUBE_PAGE_LOAD_STATE.lock().unwrap();
    let attempt_changed = state.record_page_load(webview_generation, url, event);
    drop(state);
    if attempt_changed {
        YOUTUBE_PAGE_LOAD_NOTIFY.notify_one();
    }
}

fn youtube_navigation_attempt_finished(token: &YouTubeNavigationAttemptToken) -> bool {
    YOUTUBE_PAGE_LOAD_STATE
        .lock()
        .unwrap()
        .navigation_attempt_finished(token)
}

fn clear_youtube_navigation_attempt(token: &YouTubeNavigationAttemptToken) {
    YOUTUBE_PAGE_LOAD_STATE
        .lock()
        .unwrap()
        .clear_navigation_attempt(token);
}

fn youtube_url_matches_path(url: &Url, expected_path: &str) -> bool {
    matches!(
        url.host_str()
            .map(|host| host.to_ascii_lowercase())
            .as_deref(),
        Some("youtube.com" | "www.youtube.com" | "m.youtube.com")
    ) && url.path().trim_end_matches('/') == expected_path.trim_end_matches('/')
}

fn sanitized_youtube_path(url: &Url) -> String {
    match url.host_str() {
        Some(host) => format!("{}{}", host.to_ascii_lowercase(), url.path()),
        None => url.path().to_string(),
    }
}

fn current_youtube_window_path(window: &tauri::WebviewWindow) -> String {
    window
        .url()
        .map(|url| sanitized_youtube_path(&url))
        .unwrap_or_else(|_| "unavailable".to_string())
}

fn classify_capture_event(
    payload: &YouTubeCapturePayload,
    expected_capture_id: &str,
    expected_stage: &str,
) -> YouTubeCaptureEventDisposition {
    if payload.capture_id.as_deref() != Some(expected_capture_id)
        || payload.stage.as_deref() != Some(expected_stage)
    {
        return YouTubeCaptureEventDisposition::Ignore;
    }
    if payload
        .error
        .as_ref()
        .is_some_and(|error| !error.is_empty())
    {
        return YouTubeCaptureEventDisposition::Error;
    }
    if payload.done == Some(true) {
        return YouTubeCaptureEventDisposition::Complete;
    }
    YouTubeCaptureEventDisposition::Progress
}

fn capture_cancellation_matches(
    active_capture_id: Option<&str>,
    requested_capture_id: &str,
) -> bool {
    active_capture_id == Some(requested_capture_id)
}

fn cancel_youtube_capture(capture_id: &str) -> YouTubeCaptureCancellation {
    let mut active = YOUTUBE_ACTIVE_CAPTURE.lock().unwrap();
    let active_id = active.as_ref().map(|capture| capture.capture_id.as_str());
    if !capture_cancellation_matches(active_id, capture_id) {
        return YouTubeCaptureCancellation::NoMatch;
    }
    let cancellation = active
        .as_mut()
        .map(|capture| {
            capture.cancelled = true;
            if capture.session_claimed {
                YouTubeCaptureCancellation::SessionActive
            } else {
                YouTubeCaptureCancellation::Queued
            }
        })
        .unwrap_or(YouTubeCaptureCancellation::NoMatch);
    drop(active);
    YOUTUBE_CAPTURE_CANCEL_NOTIFY.notify_one();
    cancellation
}

fn youtube_capture_is_cancelled(capture_id: &str) -> bool {
    YOUTUBE_ACTIVE_CAPTURE
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|capture| capture.capture_id == capture_id && capture.cancelled)
}

fn ensure_youtube_capture_active(capture_id: &str) -> Result<(), String> {
    if youtube_capture_is_cancelled(capture_id) {
        Err("YouTube capture was cancelled.".to_string())
    } else {
        Ok(())
    }
}

async fn wait_for_youtube_capture_cancellation(capture_id: &str) {
    loop {
        let notification = YOUTUBE_CAPTURE_CANCEL_NOTIFY.notified();
        if youtube_capture_is_cancelled(capture_id) {
            return;
        }
        notification.await;
    }
}

async fn wait_for_youtube_capture_finished(capture_id: &str) {
    loop {
        let notification = YOUTUBE_CAPTURE_FINISHED_NOTIFY.notified();
        let still_active = YOUTUBE_ACTIVE_CAPTURE
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|capture| capture.capture_id == capture_id);
        if !still_active {
            return;
        }
        notification.await;
    }
}

fn begin_youtube_capture_session<T>(
    capture_id: &str,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let mut active = YOUTUBE_ACTIVE_CAPTURE.lock().unwrap();
    let capture = active
        .as_mut()
        .filter(|capture| capture.capture_id == capture_id)
        .ok_or_else(|| "YouTube capture is no longer active.".to_string())?;
    if capture.cancelled {
        return Err("YouTube capture was cancelled.".to_string());
    }
    capture.session_claimed = true;
    operation()
}

fn capture_stop_reason(payload: &YouTubeCapturePayload) -> &str {
    payload.stop_reason.as_deref().unwrap_or("not reported")
}

fn validate_capture_terminal(stage: &str, payload: &YouTubeCapturePayload) -> Result<(), String> {
    if let Some(error) = payload.error.as_ref().filter(|error| !error.is_empty()) {
        return Err(error.clone());
    }
    if payload.done != Some(true) {
        return Err(format!(
            "YouTube {stage} capture ended without a final marker."
        ));
    }
    if payload.stop_reason.as_deref() != Some("end-stable")
        || payload.unresolved_count != Some(0)
        || payload.page_evidence != Some(true)
        || payload.unsupported_candidate_count != Some(0)
        || payload.pending_continuation != Some(false)
        || payload.work_budget_exceeded != Some(false)
        || payload.deadline_exceeded != Some(false)
    {
        return Err(format!(
            "YouTube {stage} capture ended without complete page evidence. Stage: {stage}. Stop reason: {}.",
            capture_stop_reason(payload)
        ));
    }
    let channel_total_matches = payload.channel_total == u64::try_from(payload.channels.len()).ok();
    let video_total_matches = payload.video_total == u64::try_from(payload.videos.len()).ok();
    if !channel_total_matches || !video_total_matches {
        return Err(format!(
            "YouTube {stage} capture record totals did not match its terminal receipt."
        ));
    }
    let stage_records_empty = match stage {
        "channels" => payload.channels.is_empty(),
        "subscriptions" => payload.videos.is_empty(),
        _ => false,
    };
    if stage_records_empty && payload.explicit_empty != Some(true) {
        return Err(format!(
            "YouTube {stage} capture did not prove an explicit empty state."
        ));
    }
    match stage {
        "channels" if payload.roster_complete != Some(true) => Err(format!(
            "YouTube channels capture ended before the full roster was resolved. Stage: channels. Stop reason: {}.",
            capture_stop_reason(payload)
        )),
        "subscriptions" if payload.complete != Some(true) => Err(format!(
            "YouTube subscriptions capture ended before extraction completed. Stage: subscriptions. Stop reason: {}.",
            capture_stop_reason(payload)
        )),
        "channels" | "subscriptions" => Ok(()),
        _ => Err("Unsupported YouTube capture stage.".to_string()),
    }
}

fn youtube_url(path: &str) -> Result<Url, String> {
    path.parse::<Url>().map_err(|error| error.to_string())
}

fn build_youtube_session_window_for_generation(
    app: &tauri::AppHandle,
    url: &str,
    interactive: bool,
    webview_generation: u64,
) -> Result<tauri::WebviewWindow, String> {
    let presentation = YouTubeWindowPresentation::from_interactive(interactive);
    let window = tauri::WebviewWindowBuilder::new(
        app,
        YOUTUBE_SESSION_WINDOW_LABEL,
        tauri::WebviewUrl::External(youtube_url(url)?),
    )
    .data_store_identifier(YOUTUBE_SESSION_DATA_STORE_IDENTIFIER)
    .initialization_script(YOUTUBE_AUTH_OBSERVER_SCRIPT)
    .title("YouTube with Freed")
    .inner_size(1280.0, 900.0)
    .center()
    .visible(presentation == YouTubeWindowPresentation::Interactive)
    .focused(interactive)
    .focusable(interactive)
    .always_on_bottom(!interactive)
    .on_page_load(move |_window, payload| {
        record_youtube_page_load(webview_generation, payload.url(), payload.event());
    })
    .build()
    .map_err(|error| error.to_string())?;
    super::observe_window_created(YOUTUBE_SESSION_WINDOW_LABEL);

    let close_app = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            let _ = close_app.emit(
                "yt-login-window-closed",
                serde_json::json!({ "closed": true }),
            );
        }
    });
    Ok(window)
}

fn build_youtube_session_window(
    app: &tauri::AppHandle,
    url: &str,
    interactive: bool,
) -> Result<tauri::WebviewWindow, String> {
    let webview_generation = reserve_youtube_webview_generation();
    match build_youtube_session_window_for_generation(app, url, interactive, webview_generation) {
        Ok(window) => Ok(window),
        Err(error) => {
            retire_youtube_webview_generation(webview_generation);
            Err(error)
        }
    }
}

fn ensure_youtube_session_window(
    app: &tauri::AppHandle,
    url: &str,
    interactive: bool,
) -> Result<tauri::WebviewWindow, String> {
    let presentation = YouTubeWindowPresentation::from_interactive(interactive);
    let window = match app.get_webview_window(YOUTUBE_SESSION_WINDOW_LABEL) {
        Some(window) => {
            if presentation == YouTubeWindowPresentation::Hidden {
                apply_youtube_window_presentation(&window, presentation)?;
            }
            window
                .navigate(youtube_url(url)?)
                .map_err(|error| error.to_string())?;
            window
        }
        None => build_youtube_session_window(app, url, interactive)?,
    };

    apply_youtube_window_presentation(&window, presentation)?;
    Ok(window)
}

fn navigate_youtube_capture_session_window(
    window: &tauri::WebviewWindow,
    url: &str,
    stage: &str,
) -> Result<YouTubeNavigationAttemptToken, String> {
    let navigation_url = youtube_url(url)?;
    let attempt = begin_youtube_navigation_attempt(youtube_capture_path(stage)?)?;
    if let Err(error) = window
        .navigate(navigation_url)
        .map_err(|error| error.to_string())
    {
        clear_youtube_navigation_attempt(&attempt);
        return Err(error);
    }
    Ok(attempt)
}

fn ensure_youtube_capture_session_window(
    app: &tauri::AppHandle,
    url: &str,
    stage: &str,
) -> Result<(tauri::WebviewWindow, YouTubeNavigationAttemptToken), String> {
    let presentation = YouTubeWindowPresentation::Hidden;
    let (window, attempt) = match app.get_webview_window(YOUTUBE_SESSION_WINDOW_LABEL) {
        Some(window) => {
            apply_youtube_window_presentation(&window, presentation)?;
            let attempt = navigate_youtube_capture_session_window(&window, url, stage)?;
            (window, attempt)
        }
        None => {
            let webview_generation = reserve_youtube_webview_generation();
            let attempt = match begin_youtube_navigation_attempt(youtube_capture_path(stage)?) {
                Ok(attempt) => attempt,
                Err(error) => {
                    retire_youtube_webview_generation(webview_generation);
                    return Err(error);
                }
            };
            let window = match build_youtube_session_window_for_generation(
                app,
                url,
                false,
                webview_generation,
            ) {
                Ok(window) => window,
                Err(error) => {
                    clear_youtube_navigation_attempt(&attempt);
                    retire_youtube_webview_generation(webview_generation);
                    return Err(error);
                }
            };
            (window, attempt)
        }
    };

    if let Err(error) = apply_youtube_window_presentation(&window, presentation) {
        clear_youtube_navigation_attempt(&attempt);
        return Err(error);
    }
    Ok((window, attempt))
}

fn hide_youtube_session_window(
    app: &tauri::AppHandle,
    restore_main_focus: bool,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(YOUTUBE_SESSION_WINDOW_LABEL) {
        apply_youtube_window_presentation(&window, YouTubeWindowPresentation::Hidden)?;
    }
    if restore_main_focus {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.set_focus();
        }
    }
    Ok(())
}

fn destroy_youtube_session_window(
    app: &tauri::AppHandle,
    restore_main_focus: bool,
    retention: YouTubeDataRetention,
    reason: super::WindowDestroyedReason,
    detail: &str,
) -> Result<(), String> {
    let webview_generation = current_youtube_webview_generation().ok();
    if let Some(window) = app.get_webview_window(YOUTUBE_SESSION_WINDOW_LABEL) {
        if retention.scrubs_before_destroy() {
            let _ = apply_youtube_window_presentation(&window, YouTubeWindowPresentation::Hidden);
            super::scrub_webview_before_destroy(&window);
        }
        if retention.clears_browsing_data() {
            let _ = window.clear_all_browsing_data();
        }
        window.destroy().map_err(|error| error.to_string())?;
        super::record_window_destroyed(app, YOUTUBE_SESSION_WINDOW_LABEL, reason, detail);
    }
    if let Some(webview_generation) = webview_generation {
        retire_youtube_webview_generation(webview_generation);
    }
    if restore_main_focus {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.set_focus();
        }
    }
    Ok(())
}

fn operation_with_cleanup<T>(
    operation: Result<T, String>,
    cleanup: Result<(), String>,
) -> Result<T, String> {
    match (operation, cleanup) {
        (Ok(value), Ok(())) => Ok(value),
        (Ok(_), Err(cleanup_error)) => Err(cleanup_error),
        (Err(operation_error), Ok(())) => Err(operation_error),
        (Err(operation_error), Err(cleanup_error)) => Err(format!(
            "{operation_error} YouTube session cleanup also failed: {cleanup_error}"
        )),
    }
}

fn canonical_watch_url(video_url: &str) -> Result<(String, String), String> {
    let parsed = Url::parse(video_url).map_err(|_| "Invalid YouTube video URL.".to_string())?;
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("YouTube video URLs must use HTTPS.".to_string());
    }

    let host = parsed
        .host_str()
        .map(|value| value.to_ascii_lowercase())
        .ok_or_else(|| "YouTube video URL is missing a host.".to_string())?;
    let video_id = match host.as_str() {
        "youtube.com" | "www.youtube.com" | "m.youtube.com" => match parsed.path() {
            "/watch" => parsed
                .query_pairs()
                .find_map(|(key, value)| (key == "v").then(|| value.into_owned())),
            path if path.starts_with("/shorts/")
                || path.starts_with("/live/")
                || path.starts_with("/embed/") =>
            {
                path.split('/')
                    .filter(|segment| !segment.is_empty())
                    .nth(1)
                    .map(str::to_string)
            }
            _ => None,
        },
        "youtu.be" | "www.youtu.be" => parsed
            .path_segments()
            .and_then(|mut segments| segments.next())
            .map(str::to_string),
        _ => None,
    }
    .filter(|value| is_youtube_video_id(value))
    .ok_or_else(|| "This is not a supported YouTube video URL.".to_string())?;

    Ok((
        format!("https://www.youtube.com/watch?v={video_id}"),
        video_id,
    ))
}

fn is_youtube_video_id(value: &str) -> bool {
    value.len() == 11
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn replace_quoted_script_placeholder(
    script: String,
    placeholder: &str,
    value: &str,
) -> Result<String, String> {
    let quoted_placeholder = format!("\"{placeholder}\"");
    if !script.contains(&quoted_placeholder) {
        return Err(format!(
            "YouTube capture script is missing the {placeholder} placeholder."
        ));
    }
    let encoded = serde_json::to_string(value).map_err(|error| error.to_string())?;
    Ok(script.replacen(&quoted_placeholder, &encoded, 1))
}

fn capture_script(stage: &str, capture_id: &str) -> Result<String, String> {
    let expected_path = youtube_capture_path(stage)?;
    let script = replace_quoted_script_placeholder(
        YOUTUBE_CAPTURE_SCRIPT.to_string(),
        "__YOUTUBE_CAPTURE_ID__",
        capture_id,
    )?;
    let script =
        replace_quoted_script_placeholder(script, "__EXPECTED_YOUTUBE_CAPTURE_STAGE__", stage)?;
    replace_quoted_script_placeholder(script, "__EXPECTED_YOUTUBE_CAPTURE_PATH__", expected_path)
}

fn playlist_script(video_id: &str) -> Result<String, String> {
    let video_id = serde_json::to_string(video_id).map_err(|error| error.to_string())?;
    Ok(YOUTUBE_PLAYLIST_ACTION_SCRIPT.replacen("\"__EXPECTED_YOUTUBE_VIDEO_ID__\"", &video_id, 1))
}

fn capture_includes_roster(include_roster: Option<bool>) -> bool {
    include_roster.unwrap_or(true)
}

async fn wait_for_capture_stage(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    stage: &str,
    capture_id: &str,
) -> Result<YouTubeCapturePayload, String> {
    let (sender, receiver) = oneshot::channel::<YouTubeCapturePayload>();
    let sender = Arc::new(Mutex::new(Some(sender)));
    let latest_progress = Arc::new(Mutex::new(None::<YouTubeCapturePayload>));
    let listener_sender = sender.clone();
    let listener_progress = latest_progress.clone();
    let expected_stage = stage.to_string();
    let expected_capture_id = capture_id.to_string();
    let listener_id = app.listen("yt-capture-data", move |event| {
        let Ok(payload) = serde_json::from_str::<YouTubeCapturePayload>(event.payload()) else {
            return;
        };
        match classify_capture_event(&payload, &expected_capture_id, &expected_stage) {
            YouTubeCaptureEventDisposition::Ignore => {}
            YouTubeCaptureEventDisposition::Progress => {
                *listener_progress.lock().unwrap() = Some(payload);
            }
            YouTubeCaptureEventDisposition::Complete | YouTubeCaptureEventDisposition::Error => {
                if let Some(sender) = listener_sender.lock().unwrap().take() {
                    let _ = sender.send(payload);
                }
            }
        }
    });
    let listener_guard = YouTubeListenerGuard::new(app, listener_id);

    window
        .eval(&capture_script(stage, capture_id)?)
        .map_err(|error| error.to_string())?;

    let deadline = Instant::now() + YOUTUBE_CAPTURE_STAGE_TIMEOUT;
    let result = tokio::select! {
        received = receiver => received
            .map_err(|_| format!("YouTube {stage} capture listener closed.")),
        _ = sleep_until(deadline) => {
            let progress = latest_progress.lock().unwrap().clone().unwrap_or_default();
            Err(format!(
                "YouTube {stage} capture timed out. Stage: {stage}. Path: {}. Stop reason: {}.",
                current_youtube_window_path(window),
                capture_stop_reason(&progress),
            ))
        },
        _ = wait_for_youtube_capture_cancellation(capture_id) => {
            Err("YouTube capture was cancelled.".to_string())
        },
    };
    drop(listener_guard);
    result
}

async fn wait_for_capture_navigation(
    window: &tauri::WebviewWindow,
    stage: &str,
    capture_id: &str,
    attempt: YouTubeNavigationAttemptToken,
) -> Result<(), String> {
    let expected_path = youtube_capture_path(stage)?;
    if attempt.expected_path != expected_path {
        clear_youtube_navigation_attempt(&attempt);
        return Err("YouTube capture navigation attempt did not match its stage.".to_string());
    }
    let deadline = Instant::now() + YOUTUBE_CAPTURE_NAVIGATION_TIMEOUT;
    let result = loop {
        let load_notification = YOUTUBE_PAGE_LOAD_NOTIFY.notified();
        if youtube_navigation_attempt_finished(&attempt)
            && window
                .url()
                .ok()
                .is_some_and(|url| youtube_url_matches_path(&url, expected_path))
        {
            break Ok(());
        }
        if let Err(error) = ensure_youtube_capture_active(capture_id) {
            break Err(error);
        }
        tokio::select! {
            _ = load_notification => {}
            _ = sleep_until(deadline) => {
                break Err(format!(
                    "YouTube {stage} navigation timed out. Stage: {stage}. Path: {}. Stop reason: page load did not finish.",
                    current_youtube_window_path(window),
                ));
            }
            _ = wait_for_youtube_capture_cancellation(capture_id) => {
                break Err("YouTube capture was cancelled.".to_string());
            }
        }
    };
    clear_youtube_navigation_attempt(&attempt);
    result
}

async fn wait_for_playlist_result(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    video_id: &str,
) -> Result<YouTubePlaylistPayload, String> {
    let (sender, receiver) = oneshot::channel::<Result<YouTubePlaylistPayload, String>>();
    let sender = Arc::new(Mutex::new(Some(sender)));
    let listener_sender = sender.clone();
    let expected_video_id = video_id.to_string();
    let listener_id = app.listen("yt-playlist-result", move |event| {
        let payload = serde_json::from_str::<YouTubePlaylistPayload>(event.payload())
            .map_err(|error| error.to_string());
        let matches = payload
            .as_ref()
            .ok()
            .and_then(|payload| payload.video_id.as_deref())
            == Some(expected_video_id.as_str());
        if matches {
            if let Some(sender) = listener_sender.lock().unwrap().take() {
                let _ = sender.send(payload);
            }
        }
    });

    if let Err(error) = window.eval(&playlist_script(video_id)?) {
        app.unlisten(listener_id);
        return Err(error.to_string());
    }

    let result = timeout(Duration::from_secs(56), receiver)
        .await
        .map_err(|_| "YouTube playlist action timed out.".to_string())
        .and_then(|received| {
            received.map_err(|_| "YouTube playlist action listener closed.".to_string())
        });
    app.unlisten(listener_id);
    result?
}

async fn wait_for_auth_result(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<bool, String> {
    let (sender, receiver) = oneshot::channel::<Result<YouTubeAuthPayload, String>>();
    let sender = Arc::new(Mutex::new(Some(sender)));
    let listener_sender = sender.clone();
    let listener_id = app.listen("yt-auth-result", move |event| {
        let payload = serde_json::from_str::<YouTubeAuthPayload>(event.payload())
            .map_err(|error| error.to_string());
        if let Some(sender) = listener_sender.lock().unwrap().take() {
            let _ = sender.send(payload);
        }
    });
    if let Err(error) = window.eval(YOUTUBE_AUTH_PROBE_SCRIPT) {
        app.unlisten(listener_id);
        return Err(error.to_string());
    }
    let result = timeout(Duration::from_secs(12), receiver)
        .await
        .map_err(|_| "YouTube authentication check timed out.".to_string())
        .and_then(|received| {
            received.map_err(|_| "YouTube authentication listener closed.".to_string())
        });
    app.unlisten(listener_id);
    Ok(result??.logged_in)
}

#[tauri::command]
pub async fn yt_show_login(app: tauri::AppHandle) -> Result<(), String> {
    let _operation = YOUTUBE_SESSION_OPERATION.lock().await;
    ensure_youtube_session_window(&app, YOUTUBE_SUBSCRIPTIONS_URL, true)?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn yt_hide_login(
    app: tauri::AppHandle,
    capture_id: Option<String>,
) -> Result<(), String> {
    if let Some(capture_id) = capture_id {
        let cancellation = cancel_youtube_capture(&capture_id);
        let cleanup = match cancellation {
            YouTubeCaptureCancellation::NoMatch | YouTubeCaptureCancellation::Queued => Ok(()),
            YouTubeCaptureCancellation::SessionActive => destroy_youtube_session_window(
                &app,
                false,
                YouTubeDataRetention::Preserve,
                super::WindowDestroyedReason::JobComplete,
                "youtube_capture_cancelled",
            ),
        };
        if cancellation != YouTubeCaptureCancellation::NoMatch {
            wait_for_youtube_capture_finished(&capture_id).await;
        }
        return cleanup;
    }
    hide_youtube_session_window(&app, true)
}

#[tauri::command]
pub async fn yt_check_auth(app: tauri::AppHandle) -> Result<bool, String> {
    let _operation = YOUTUBE_SESSION_OPERATION.lock().await;
    let result = async {
        let window = ensure_youtube_session_window(&app, YOUTUBE_SUBSCRIPTIONS_URL, false)?;
        tokio::time::sleep(Duration::from_secs(3)).await;
        wait_for_auth_result(&app, &window).await
    }
    .await;
    let _ = hide_youtube_session_window(&app, false);
    result
}

#[tauri::command(rename_all = "camelCase")]
pub async fn yt_capture(
    app: tauri::AppHandle,
    include_roster: Option<bool>,
    capture_id: String,
) -> Result<YouTubeCaptureResult, String> {
    let _capture_guard = YouTubeCaptureGuard::begin(&capture_id)?;
    let queue_deadline = Instant::now() + YOUTUBE_CAPTURE_QUEUE_TIMEOUT;
    let _operation = tokio::select! {
        operation = YOUTUBE_SESSION_OPERATION.lock() => operation,
        _ = sleep_until(queue_deadline) => {
            return Err("YouTube capture waited too long for the session window.".to_string());
        },
        _ = wait_for_youtube_capture_cancellation(&capture_id) => {
            return Err("YouTube capture was cancelled.".to_string());
        },
    };
    let overall_deadline = Instant::now() + YOUTUBE_CAPTURE_OVERALL_TIMEOUT;
    let capture_result = timeout_at(overall_deadline, async {
        let include_roster = capture_includes_roster(include_roster);
        let mut stages = Vec::with_capacity(if include_roster { 2 } else { 1 });
        let first_url = if include_roster {
            YOUTUBE_CHANNELS_URL
        } else {
            YOUTUBE_SUBSCRIPTIONS_URL
        };
        let first_stage = if include_roster {
            "channels"
        } else {
            "subscriptions"
        };
        let (window, navigation_attempt) = begin_youtube_capture_session(&capture_id, || {
            ensure_youtube_capture_session_window(&app, first_url, first_stage)
        })?;
        wait_for_capture_navigation(
            &window,
            first_stage,
            &capture_id,
            navigation_attempt,
        )
        .await?;

        if include_roster {
            let channels = wait_for_capture_stage(&app, &window, "channels", &capture_id).await?;
            validate_capture_terminal("channels", &channels)?;
            stages.push(channels);
            ensure_youtube_capture_active(&capture_id)?;

            let navigation_attempt = navigate_youtube_capture_session_window(
                &window,
                YOUTUBE_SUBSCRIPTIONS_URL,
                "subscriptions",
            )?;
            wait_for_capture_navigation(
                &window,
                "subscriptions",
                &capture_id,
                navigation_attempt,
            )
            .await?;
        }

        let subscriptions =
            wait_for_capture_stage(&app, &window, "subscriptions", &capture_id).await?;
        validate_capture_terminal("subscriptions", &subscriptions)?;
        stages.push(subscriptions);
        ensure_youtube_capture_active(&capture_id)?;
        Ok(YouTubeCaptureResult { stages })
    })
    .await
    .map_err(|_| {
        let path = app
            .get_webview_window(YOUTUBE_SESSION_WINDOW_LABEL)
            .map(|window| current_youtube_window_path(&window))
            .unwrap_or_else(|| "unavailable".to_string());
        format!(
            "YouTube capture reached its overall deadline. Stage: overall. Path: {path}. Stop reason: overall deadline reached."
        )
    })
    .and_then(|result| result);
    let cleanup = destroy_youtube_session_window(
        &app,
        false,
        YouTubeDataRetention::Preserve,
        super::WindowDestroyedReason::JobComplete,
        "youtube_capture_complete",
    );
    operation_with_cleanup(capture_result, cleanup)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn yt_add_to_offline_playlist(
    app: tauri::AppHandle,
    video_url: String,
) -> Result<(), String> {
    let _operation = YOUTUBE_SESSION_OPERATION.lock().await;
    let result = async {
        let (watch_url, video_id) = canonical_watch_url(&video_url)?;
        let window = ensure_youtube_session_window(&app, &watch_url, false)?;
        tokio::time::sleep(Duration::from_secs(3)).await;
        let playlist = wait_for_playlist_result(&app, &window, &video_id).await?;
        if playlist.result.is_none() {
            return Err("YouTube playlist action returned no result.".to_string());
        }
        Ok(())
    }
    .await;
    let _ = hide_youtube_session_window(&app, false);
    result
}

#[tauri::command]
pub async fn yt_disconnect(app: tauri::AppHandle) -> Result<(), String> {
    let _operation = YOUTUBE_SESSION_OPERATION.lock().await;
    destroy_youtube_session_window(
        &app,
        false,
        YouTubeDataRetention::ClearForDisconnect,
        super::WindowDestroyedReason::User,
        "youtube_disconnect",
    )?;
    tokio::time::sleep(Duration::from_millis(250)).await;

    #[cfg(target_vendor = "apple")]
    {
        let stores = app
            .fetch_data_store_identifiers()
            .await
            .map_err(|error| error.to_string())?;
        if stores.contains(&YOUTUBE_SESSION_DATA_STORE_IDENTIFIER) {
            app.remove_data_store(YOUTUBE_SESSION_DATA_STORE_IDENTIFIER)
                .await
                .map_err(|error| error.to_string())?;
        }
    }
    let _ = app.emit(
        "yt-login-window-closed",
        serde_json::json!({ "closed": true }),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Debug, Eq, PartialEq)]
    enum RecordedYouTubeWindowAction {
        AlwaysOnBottom(bool),
        Focusable(bool),
        Show,
        Hide,
        Focus,
    }

    #[derive(Default)]
    struct RecordingYouTubeWindow {
        actions: RefCell<Vec<RecordedYouTubeWindowAction>>,
    }

    impl YouTubeWindowControls for RecordingYouTubeWindow {
        fn set_youtube_always_on_bottom(&self, always_on_bottom: bool) {
            self.actions
                .borrow_mut()
                .push(RecordedYouTubeWindowAction::AlwaysOnBottom(
                    always_on_bottom,
                ));
        }

        fn set_youtube_focusable(&self, focusable: bool) {
            self.actions
                .borrow_mut()
                .push(RecordedYouTubeWindowAction::Focusable(focusable));
        }

        fn show_youtube_window(&self) -> Result<(), String> {
            self.actions
                .borrow_mut()
                .push(RecordedYouTubeWindowAction::Show);
            Ok(())
        }

        fn hide_youtube_window(&self) -> Result<(), String> {
            self.actions
                .borrow_mut()
                .push(RecordedYouTubeWindowAction::Hide);
            Ok(())
        }

        fn focus_youtube_window(&self) {
            self.actions
                .borrow_mut()
                .push(RecordedYouTubeWindowAction::Focus);
        }
    }

    #[test]
    fn hidden_youtube_presentation_hides_without_showing_or_focusing() {
        let window = RecordingYouTubeWindow::default();
        apply_youtube_window_presentation(&window, YouTubeWindowPresentation::Hidden).unwrap();

        assert_eq!(
            *window.actions.borrow(),
            vec![
                RecordedYouTubeWindowAction::AlwaysOnBottom(true),
                RecordedYouTubeWindowAction::Focusable(false),
                RecordedYouTubeWindowAction::Hide,
            ]
        );
    }

    #[test]
    fn interactive_youtube_presentation_shows_and_focuses() {
        let window = RecordingYouTubeWindow::default();
        apply_youtube_window_presentation(&window, YouTubeWindowPresentation::Interactive).unwrap();

        assert_eq!(
            *window.actions.borrow(),
            vec![
                RecordedYouTubeWindowAction::AlwaysOnBottom(false),
                RecordedYouTubeWindowAction::Focusable(true),
                RecordedYouTubeWindowAction::Show,
                RecordedYouTubeWindowAction::Focus,
            ]
        );
    }

    #[test]
    fn canonical_watch_url_accepts_supported_youtube_routes() {
        for input in [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com/shorts/dQw4w9WgXcQ?feature=share",
            "https://m.youtube.com/live/dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ?t=42",
        ] {
            assert_eq!(
                canonical_watch_url(input).unwrap(),
                (
                    "https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_string(),
                    "dQw4w9WgXcQ".to_string()
                )
            );
        }
    }

    #[test]
    fn canonical_watch_url_rejects_non_youtube_and_malformed_routes() {
        for input in [
            "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://example.com/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/watch?v=too-short",
            "https://www.youtube.com/feed/subscriptions",
        ] {
            assert!(canonical_watch_url(input).is_err(), "accepted {input}");
        }
    }

    #[test]
    fn capture_script_declares_the_requested_stage() {
        let script = capture_script("channels", "capture-123").unwrap();
        assert!(script.contains("/feed/channels"));
        assert!(script.contains("/feed/subscriptions"));
        assert!(script.contains("capture-123"));
        assert!(!script.contains("__YOUTUBE_CAPTURE_ID__"));
        assert!(!script.contains("__EXPECTED_YOUTUBE_CAPTURE_STAGE__"));
        assert!(!script.contains("__EXPECTED_YOUTUBE_CAPTURE_PATH__"));
        assert!(script.contains("unresolved.size === 0"));
        assert!(script.contains("hasPositiveStagePageEvidence"));
        assert!(script.contains("yt-capture-data"));
        for field in [
            "captureId",
            "channels",
            "videos",
            "channelTotal",
            "videoTotal",
            "candidateCount",
            "rosterComplete",
            "complete",
            "unresolvedCount",
            "pageEvidence",
            "explicitEmpty",
            "unsupportedCandidateCount",
            "pendingContinuation",
            "scrollPasses",
            "stopReason",
            "done",
        ] {
            assert!(script.contains(field), "capture script is missing {field}");
        }
    }

    #[test]
    fn capture_script_json_encodes_injected_values() {
        let script = capture_script("subscriptions", "capture-\"quoted\"").unwrap();
        assert!(script.contains(r#""capture-\"quoted\"""#));
        assert!(!script.contains(r#"const captureId = "capture-"quoted""#));
    }

    fn capture_payload(capture_id: &str, stage: &str) -> YouTubeCapturePayload {
        YouTubeCapturePayload {
            capture_id: Some(capture_id.to_string()),
            stage: Some(stage.to_string()),
            ..YouTubeCapturePayload::default()
        }
    }

    fn complete_capture_payload(capture_id: &str, stage: &str) -> YouTubeCapturePayload {
        YouTubeCapturePayload {
            done: Some(true),
            stop_reason: Some("end-stable".to_string()),
            page_evidence: Some(true),
            explicit_empty: Some(true),
            unresolved_count: Some(0),
            unsupported_candidate_count: Some(0),
            pending_continuation: Some(false),
            work_budget_exceeded: Some(false),
            deadline_exceeded: Some(false),
            channel_total: Some(0),
            video_total: Some(0),
            ..capture_payload(capture_id, stage)
        }
    }

    #[test]
    fn capture_events_require_exact_capture_and_stage_matches() {
        let matching = capture_payload("capture-123", "channels");
        assert_eq!(
            classify_capture_event(&matching, "capture-123", "channels"),
            YouTubeCaptureEventDisposition::Progress
        );

        let wrong_capture = capture_payload("capture-456", "channels");
        assert_eq!(
            classify_capture_event(&wrong_capture, "capture-123", "channels"),
            YouTubeCaptureEventDisposition::Ignore
        );

        let wrong_stage = capture_payload("capture-123", "subscriptions");
        assert_eq!(
            classify_capture_event(&wrong_stage, "capture-123", "channels"),
            YouTubeCaptureEventDisposition::Ignore
        );
    }

    #[test]
    fn capture_progress_is_nonterminal_until_done_or_error() {
        let mut payload = capture_payload("capture-123", "channels");
        payload.channel_total = Some(120);
        payload.scroll_passes = Some(4);
        assert_eq!(
            classify_capture_event(&payload, "capture-123", "channels"),
            YouTubeCaptureEventDisposition::Progress
        );

        payload.done = Some(true);
        assert_eq!(
            classify_capture_event(&payload, "capture-123", "channels"),
            YouTubeCaptureEventDisposition::Complete
        );

        payload.done = Some(false);
        payload.error = Some("capture failed".to_string());
        assert_eq!(
            classify_capture_event(&payload, "capture-123", "channels"),
            YouTubeCaptureEventDisposition::Error
        );
    }

    #[test]
    fn terminal_capture_requires_stage_completeness() {
        let mut channels = complete_capture_payload("capture-123", "channels");
        channels.stop_reason = Some("max-passes".to_string());
        let channels_error = validate_capture_terminal("channels", &channels).unwrap_err();
        assert!(channels_error.contains("Stage: channels"));
        assert!(channels_error.contains("max-passes"));
        channels.stop_reason = Some("end-stable".to_string());
        channels.roster_complete = Some(true);
        assert!(validate_capture_terminal("channels", &channels).is_ok());

        let mut subscriptions = complete_capture_payload("capture-123", "subscriptions");
        assert!(validate_capture_terminal("subscriptions", &subscriptions).is_err());
        subscriptions.complete = Some(true);
        assert!(validate_capture_terminal("subscriptions", &subscriptions).is_ok());

        subscriptions.video_total = Some(1);
        assert!(validate_capture_terminal("subscriptions", &subscriptions).is_err());
    }

    #[test]
    fn terminal_capture_requires_explicit_safe_evidence_flags() {
        let mut channels = complete_capture_payload("capture-123", "channels");
        channels.roster_complete = Some(true);

        channels.work_budget_exceeded = None;
        assert!(validate_capture_terminal("channels", &channels).is_err());

        channels.work_budget_exceeded = Some(false);
        channels.deadline_exceeded = None;
        assert!(validate_capture_terminal("channels", &channels).is_err());

        channels.deadline_exceeded = Some(false);
        channels.pending_continuation = None;
        assert!(validate_capture_terminal("channels", &channels).is_err());

        channels.pending_continuation = Some(true);
        assert!(validate_capture_terminal("channels", &channels).is_err());

        channels.pending_continuation = Some(false);
        assert!(validate_capture_terminal("channels", &channels).is_ok());
    }

    #[test]
    fn capture_timeout_envelope_covers_every_native_phase() {
        let phase_ceiling = YOUTUBE_CAPTURE_NAVIGATION_TIMEOUT.as_secs() * 2
            + YOUTUBE_CAPTURE_STAGE_TIMEOUT.as_secs() * 2;
        assert!(YOUTUBE_CAPTURE_OVERALL_TIMEOUT.as_secs() >= phase_ceiling);
    }

    #[test]
    fn cancellation_only_matches_the_active_capture() {
        assert!(capture_cancellation_matches(
            Some("capture-123"),
            "capture-123"
        ));
        assert!(!capture_cancellation_matches(
            Some("capture-456"),
            "capture-123"
        ));
        assert!(!capture_cancellation_matches(None, "capture-123"));
    }

    #[test]
    fn cancellation_distinguishes_queued_and_active_capture_sessions() {
        let queued = YouTubeCaptureGuard::begin("capture-queued").unwrap();
        assert_eq!(
            cancel_youtube_capture("capture-queued"),
            YouTubeCaptureCancellation::Queued
        );
        drop(queued);

        let active = YouTubeCaptureGuard::begin("capture-active").unwrap();
        assert_eq!(
            begin_youtube_capture_session("capture-active", || Ok(42)).unwrap(),
            42
        );
        assert_eq!(
            cancel_youtube_capture("capture-active"),
            YouTubeCaptureCancellation::SessionActive
        );
        drop(active);
    }

    #[test]
    fn timeout_paths_omit_queries_and_fragments() {
        let url = Url::parse(
            "https://www.youtube.com/feed/subscriptions?account=private#sensitive-fragment",
        )
        .unwrap();
        assert_eq!(
            sanitized_youtube_path(&url),
            "www.youtube.com/feed/subscriptions"
        );
    }

    #[test]
    fn capture_page_matches_require_youtube_host_and_exact_path() {
        assert!(youtube_url_matches_path(
            &Url::parse("https://www.youtube.com/feed/channels?flow=1").unwrap(),
            "/feed/channels"
        ));
        assert!(!youtube_url_matches_path(
            &Url::parse("https://example.com/feed/channels").unwrap(),
            "/feed/channels"
        ));
        assert!(!youtube_url_matches_path(
            &Url::parse("https://www.youtube.com/feed/subscriptions").unwrap(),
            "/feed/channels"
        ));
    }

    #[test]
    fn capture_navigation_requires_matching_started_then_finished_events() {
        let mut state = YouTubePageLoadState::default();
        let generation = state.reserve_webview_generation();
        let attempt = state
            .begin_navigation_attempt("/feed/subscriptions")
            .unwrap();
        let subscriptions = Url::parse("https://www.youtube.com/feed/subscriptions").unwrap();
        let channels = Url::parse("https://www.youtube.com/feed/channels").unwrap();
        let blank = Url::parse("about:blank").unwrap();

        assert!(!state.record_page_load(generation, &subscriptions, PageLoadEvent::Finished));
        assert!(!state.navigation_attempt_finished(&attempt));
        assert!(!state.record_page_load(generation, &channels, PageLoadEvent::Started));
        assert!(!state.record_page_load(generation, &blank, PageLoadEvent::Finished));
        assert!(!state.record_page_load(
            generation.saturating_add(1),
            &subscriptions,
            PageLoadEvent::Started,
        ));
        assert!(state.record_page_load(generation, &subscriptions, PageLoadEvent::Started));
        assert!(!state.record_page_load(
            generation.saturating_add(1),
            &subscriptions,
            PageLoadEvent::Finished,
        ));
        assert!(state.record_page_load(generation, &subscriptions, PageLoadEvent::Finished));
        assert!(state.navigation_attempt_finished(&attempt));
    }

    #[test]
    fn same_path_reuse_rejects_a_finished_event_from_the_previous_attempt() {
        let mut state = YouTubePageLoadState::default();
        let generation = state.reserve_webview_generation();
        let subscriptions = Url::parse("https://www.youtube.com/feed/subscriptions").unwrap();
        let first = state
            .begin_navigation_attempt("/feed/subscriptions")
            .unwrap();
        assert!(state.record_page_load(generation, &subscriptions, PageLoadEvent::Started));
        assert!(state.record_page_load(generation, &subscriptions, PageLoadEvent::Finished));
        assert!(state.navigation_attempt_finished(&first));

        let second = state
            .begin_navigation_attempt("/feed/subscriptions")
            .unwrap();
        assert!(!state.record_page_load(generation, &subscriptions, PageLoadEvent::Finished));
        assert!(!state.navigation_attempt_finished(&second));
        assert!(state.record_page_load(generation, &subscriptions, PageLoadEvent::Started));
        assert!(state.record_page_load(generation, &subscriptions, PageLoadEvent::Finished));
        assert!(state.navigation_attempt_finished(&second));
    }

    #[test]
    fn capture_navigation_rejects_events_from_a_retired_webview_generation() {
        let mut state = YouTubePageLoadState::default();
        let retired_generation = state.reserve_webview_generation();
        let retired_attempt = state.begin_navigation_attempt("/feed/channels").unwrap();
        let current_generation = state.reserve_webview_generation();
        let current_attempt = state.begin_navigation_attempt("/feed/channels").unwrap();
        let channels = Url::parse("https://www.youtube.com/feed/channels").unwrap();

        assert!(!state.record_page_load(retired_generation, &channels, PageLoadEvent::Started));
        assert!(!state.record_page_load(retired_generation, &channels, PageLoadEvent::Finished));
        assert!(!state.navigation_attempt_finished(&retired_attempt));
        assert!(state.record_page_load(current_generation, &channels, PageLoadEvent::Started));
        assert!(state.record_page_load(current_generation, &channels, PageLoadEvent::Finished));
        assert!(state.navigation_attempt_finished(&current_attempt));
    }

    #[test]
    fn capture_roster_defaults_to_full_and_honors_incremental_mode() {
        assert!(capture_includes_roster(None));
        assert!(capture_includes_roster(Some(true)));
        assert!(!capture_includes_roster(Some(false)));
    }

    #[test]
    fn playlist_script_is_scoped_to_the_expected_video() {
        let script = playlist_script("dQw4w9WgXcQ").unwrap();
        assert!(script.contains("const expectedVideoId = \"dQw4w9WgXcQ\""));
        assert!(!script.contains("__EXPECTED_YOUTUBE_VIDEO_ID__"));
        assert!(script.contains("Freed Offline"));
        assert!(script.contains("yt-playlist-result"));
        assert!(script.contains("alreadyPresent"));
    }

    #[test]
    fn youtube_scripts_do_not_use_api_or_webview_cloaking_paths() {
        let scripts = format!(
            "{YOUTUBE_AUTH_OBSERVER_SCRIPT}\n{YOUTUBE_AUTH_PROBE_SCRIPT}\n{YOUTUBE_CAPTURE_SCRIPT}\n{YOUTUBE_PLAYLIST_ACTION_SCRIPT}"
        );
        for forbidden in [
            "youtubei",
            "googleapis.com",
            "webkit-mask",
            "user_agent",
            "visibilitystate",
            "__freed",
        ] {
            assert!(
                !scripts.to_ascii_lowercase().contains(forbidden),
                "YouTube session script contains forbidden path {forbidden}"
            );
        }
    }

    #[test]
    fn youtube_capability_is_narrowly_scoped() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/youtube-session.json")).unwrap();
        assert_eq!(capability["identifier"], "youtube-session");
        assert_eq!(
            capability["windows"],
            serde_json::json!(["youtube-session"])
        );
        assert_eq!(
            capability["permissions"],
            serde_json::json!(["core:event:allow-emit"])
        );
        let urls = capability["remote"]["urls"].as_array().unwrap();
        assert!(!urls.is_empty());
        assert!(urls.iter().all(|url| {
            url.as_str()
                .is_some_and(|value| value.starts_with("https://") && value.contains("youtube.com"))
        }));
    }

    #[test]
    fn youtube_session_has_a_dedicated_persistent_store() {
        assert_ne!(YOUTUBE_SESSION_DATA_STORE_IDENTIFIER, [0; 16]);
        assert_eq!(YOUTUBE_SESSION_DATA_STORE_IDENTIFIER.len(), 16);
        assert!(!YouTubeDataRetention::Preserve.clears_browsing_data());
        assert!(YouTubeDataRetention::ClearForDisconnect.clears_browsing_data());
        assert!(YouTubeDataRetention::Preserve.scrubs_before_destroy());
        assert!(!YouTubeDataRetention::ClearForDisconnect.scrubs_before_destroy());
    }

    #[test]
    fn cleanup_failure_is_reported_with_an_operation_failure() {
        let error = operation_with_cleanup::<()>(
            Err("capture failed".to_string()),
            Err("destroy failed".to_string()),
        )
        .unwrap_err();
        assert!(error.contains("capture failed"));
        assert!(error.contains("destroy failed"));
    }
}
