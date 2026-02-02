//! FREED Desktop Application
//!
//! Native desktop app that bundles capture, sync relay, and reader UI.

use tauri::Manager;

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

/// Tauri command to get app version
#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Tauri command to get platform info
#[tauri::command]
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

/// Fetch any URL and return its body as text (bypasses CORS)
#[tauri::command]
async fn fetch_url(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("FREED/1.0 (https://freed.wtf)")
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            // Apply vibrancy on macOS
            #[cfg(target_os = "macos")]
            apply_vibrancy(&window, NSVisualEffectMaterial::UnderWindowBackground, None, None)
                .expect("Failed to apply vibrancy");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_version, get_platform, fetch_url])
        .run(tauri::generate_context!())
        .expect("error while running FREED");
}
