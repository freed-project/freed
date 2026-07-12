use serde::Deserialize;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Listener, Manager};
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};
use url::Url;

const YOUTUBE_SESSION_WINDOW_LABEL: &str = "youtube-session";
const YOUTUBE_SUBSCRIPTIONS_URL: &str = "https://www.youtube.com/feed/subscriptions";
const YOUTUBE_CHANNELS_URL: &str = "https://www.youtube.com/feed/channels";
const YOUTUBE_CAPTURE_SCRIPT: &str = include_str!("youtube-extract.js");
const YOUTUBE_PLAYLIST_ACTION_SCRIPT: &str = include_str!("youtube-playlist-action.js");
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YouTubeCapturePayload {
    stage: Option<String>,
    done: Option<bool>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YouTubePlaylistPayload {
    video_id: Option<String>,
    result: Option<String>,
}

fn youtube_url(path: &str) -> Result<Url, String> {
    path.parse::<Url>().map_err(|error| error.to_string())
}

fn build_youtube_session_window(
    app: &tauri::AppHandle,
    url: &str,
    interactive: bool,
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
    .build()
    .map_err(|error| error.to_string())?;

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

fn capture_script(stage: &str) -> Result<String, String> {
    match stage {
        "channels" | "subscriptions" => Ok(YOUTUBE_CAPTURE_SCRIPT.to_string()),
        _ => Err("Unsupported YouTube capture stage.".to_string()),
    }
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
) -> Result<YouTubeCapturePayload, String> {
    let (sender, receiver) = oneshot::channel::<Result<YouTubeCapturePayload, String>>();
    let sender = Arc::new(Mutex::new(Some(sender)));
    let listener_sender = sender.clone();
    let expected_stage = stage.to_string();
    let listener_id = app.listen("yt-capture-data", move |event| {
        let payload = serde_json::from_str::<YouTubeCapturePayload>(event.payload())
            .map_err(|error| error.to_string());
        let matches = payload.as_ref().is_ok_and(|payload| {
            payload.stage.as_deref() == Some(expected_stage.as_str()) || payload.error.is_some()
        });
        if matches {
            if let Some(sender) = listener_sender.lock().unwrap().take() {
                let _ = sender.send(payload);
            }
        }
    });

    if let Err(error) = window.eval(&capture_script(stage)?) {
        app.unlisten(listener_id);
        return Err(error.to_string());
    }

    let result = timeout(Duration::from_secs(50), receiver)
        .await
        .map_err(|_| format!("YouTube {stage} capture timed out."))
        .and_then(|received| {
            received.map_err(|_| format!("YouTube {stage} capture listener closed."))
        });
    app.unlisten(listener_id);
    result?
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

#[tauri::command]
pub async fn yt_hide_login(app: tauri::AppHandle) -> Result<(), String> {
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
pub async fn yt_capture(app: tauri::AppHandle, include_roster: Option<bool>) -> Result<(), String> {
    let _operation = YOUTUBE_SESSION_OPERATION.lock().await;
    let result = async {
        let include_roster = capture_includes_roster(include_roster);
        let first_url = if include_roster {
            YOUTUBE_CHANNELS_URL
        } else {
            YOUTUBE_SUBSCRIPTIONS_URL
        };
        let window = ensure_youtube_session_window(&app, first_url, false)?;
        tokio::time::sleep(Duration::from_secs(3)).await;

        if include_roster {
            let channels = wait_for_capture_stage(&app, &window, "channels").await?;
            if channels.error.is_some() {
                return Ok(());
            }
            window
                .navigate(youtube_url(YOUTUBE_SUBSCRIPTIONS_URL)?)
                .map_err(|error| error.to_string())?;
            tokio::time::sleep(Duration::from_secs(3)).await;
        }

        let subscriptions = wait_for_capture_stage(&app, &window, "subscriptions").await?;
        if subscriptions.done != Some(true) && subscriptions.error.is_none() {
            return Err("YouTube subscriptions capture ended without a final marker.".to_string());
        }
        Ok(())
    }
    .await;
    let _ = hide_youtube_session_window(&app, false);
    result
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
    if let Some(window) = app.get_webview_window(YOUTUBE_SESSION_WINDOW_LABEL) {
        let _ = window.clear_all_browsing_data();
        window.destroy().map_err(|error| error.to_string())?;
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

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
        let script = capture_script("channels").unwrap();
        assert!(script.contains("/feed/channels"));
        assert!(script.contains("/feed/subscriptions"));
        assert!(script.contains("unresolved.size === 0"));
        assert!(script.contains("hasPositiveChannelPageEvidence"));
        assert!(script.contains("yt-capture-data"));
        for field in [
            "channels",
            "videos",
            "rosterComplete",
            "complete",
            "unresolvedCount",
            "scrollPasses",
            "stopReason",
            "done",
        ] {
            assert!(script.contains(field), "capture script is missing {field}");
        }
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
    }
}
