//! FREED Desktop Application
//!
//! Native desktop app that bundles capture, sync relay, and reader UI.

use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::Manager;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, RwLock};
use tokio_tungstenite::{accept_async, tungstenite::Message};

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

// Sync relay state
struct SyncRelayState {
    port: u16,
    // Channel for broadcasting document updates to all connected clients
    broadcast_tx: broadcast::Sender<Vec<u8>>,
    // Latest document state (for new clients)
    current_doc: RwLock<Option<Vec<u8>>>,
    // Connected client count
    client_count: RwLock<usize>,
}

type RelayState = Arc<SyncRelayState>;

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

/// Make authenticated request to X API
#[tauri::command]
async fn x_api_request(
    url: String,
    body: String,
    headers: std::collections::HashMap<String, String>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let mut request = client.post(&url).body(body);

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

/// Get the local IP address for sync
#[tauri::command]
fn get_local_ip() -> Result<String, String> {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .map_err(|e| e.to_string())
}

/// Get the sync relay URL
#[tauri::command]
fn get_sync_url(state: tauri::State<'_, RelayState>) -> String {
    let port = state.port;
    match local_ip_address::local_ip() {
        Ok(ip) => format!("ws://{}:{}", ip, port),
        Err(_) => format!("ws://localhost:{}", port),
    }
}

/// Get connected client count
#[tauri::command]
async fn get_sync_client_count(state: tauri::State<'_, RelayState>) -> Result<usize, String> {
    Ok(*state.client_count.read().await)
}

/// Broadcast document to all connected clients
#[tauri::command]
async fn broadcast_doc(state: tauri::State<'_, RelayState>, doc_bytes: Vec<u8>) -> Result<(), String> {
    // Store the latest document
    *state.current_doc.write().await = Some(doc_bytes.clone());
    
    // Broadcast to all connected clients (ignore send errors - clients may disconnect)
    let _ = state.broadcast_tx.send(doc_bytes);
    
    Ok(())
}

/// Handle a single WebSocket connection
async fn handle_connection(stream: TcpStream, addr: SocketAddr, state: RelayState) {
    println!("[Sync] New connection from: {}", addr);
    
    let ws_stream = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[Sync] WebSocket handshake failed: {}", e);
            return;
        }
    };
    
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    
    // Increment client count
    {
        let mut count = state.client_count.write().await;
        *count += 1;
        println!("[Sync] Client connected. Total: {}", *count);
    }
    
    // Send current document state to new client
    if let Some(doc) = state.current_doc.read().await.clone() {
        if let Err(e) = ws_sender.send(Message::Binary(doc.into())).await {
            eprintln!("[Sync] Failed to send initial doc: {}", e);
        }
    }
    
    // Subscribe to broadcast channel
    let mut broadcast_rx = state.broadcast_tx.subscribe();
    
    loop {
        tokio::select! {
            // Receive from client
            msg = ws_receiver.next() => {
                match msg {
                    Some(Ok(Message::Binary(data))) => {
                        // Client sent a document update - store and broadcast
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
            // Receive broadcasts to send to this client
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
    
    // Decrement client count
    {
        let mut count = state.client_count.write().await;
        *count = count.saturating_sub(1);
        println!("[Sync] Client disconnected. Total: {}", *count);
    }
}

/// Start the sync relay server
async fn start_sync_relay(state: RelayState) {
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
        tokio::spawn(handle_connection(stream, addr, state));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Create broadcast channel for sync
    let (broadcast_tx, _) = broadcast::channel::<Vec<u8>>(16);
    
    // Create sync relay state
    let relay_state = Arc::new(SyncRelayState {
        port: 8765,
        broadcast_tx,
        current_doc: RwLock::new(None),
        client_count: RwLock::new(0),
    });
    
    let relay_state_clone = relay_state.clone();
    
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(relay_state)
        .setup(move |app| {
            let window = app.get_webview_window("main").unwrap();

            // Apply vibrancy on macOS
            #[cfg(target_os = "macos")]
            apply_vibrancy(
                &window,
                NSVisualEffectMaterial::UnderWindowBackground,
                None,
                None,
            )
            .expect("Failed to apply vibrancy");

            // Start sync relay in background
            let state = relay_state_clone.clone();
            tokio::spawn(async move {
                start_sync_relay(state).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_version,
            get_platform,
            fetch_url,
            x_api_request,
            get_local_ip,
            get_sync_url,
            get_sync_client_count,
            broadcast_doc
        ])
        .run(tauri::generate_context!())
        .expect("error while running FREED");
}
