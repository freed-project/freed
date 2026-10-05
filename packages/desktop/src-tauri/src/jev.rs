//! User-initiated Jev calls. Credentials remain in the OS vault, never Library data.
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::Duration,
};
use tauri::Manager;
use tokio::sync::oneshot;

const ENDPOINT: &str = "https://api.typesafe.ai/v1/systemone";
const MAX_BYTES: usize = 64 * 1024;
static REQUESTS: LazyLock<Mutex<HashMap<String, Option<oneshot::Sender<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn entry() -> Result<keyring::Entry, String> {
    #[cfg(not(feature = "isolated-preview-data-root"))]
    let service = "wtf.freed.ai".to_owned();
    #[cfg(feature = "isolated-preview-data-root")]
    let service = isolated_preview_credential_service(option_env!("TAURI_CONFIG"))?;
    keyring::Entry::new(&service, "jev").map_err(|_| "Could not open the credential vault.".into())
}
#[cfg(all(
    feature = "isolated-preview-data-root",
    any(target_os = "macos", target_os = "windows", test)
))]
fn isolated_preview_credential_service(config: Option<&str>) -> Result<String, String> {
    let default = "wtf.freed.ai.isolated-preview";
    let Some(config) = config else {
        return Ok(default.into());
    };
    let config: Value =
        serde_json::from_str(config).map_err(|_| "Invalid isolated preview configuration.")?;
    let Some(identifier) = config.get("identifier").and_then(Value::as_str) else {
        return Ok(default.into());
    };
    if identifier == "wtf.freed.desktop.sqlite-native-preview" {
        return Ok(default.into());
    }
    if identifier.len() > 128
        || !identifier
            .strip_prefix("wtf.freed.desktop.preview.")
            .is_some_and(|suffix| !suffix.is_empty())
        || !identifier
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-')
    {
        return Err("Isolated preview refuses a non-preview credential namespace.".into());
    }
    Ok(format!("{default}.{identifier}"))
}
fn check_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Jev is available only from the main Freed window.".into());
    }
    Ok(())
}
static CREDENTIAL_LOCK: tokio::sync::RwLock<()> = tokio::sync::RwLock::const_new(());

fn read_key() -> Result<Option<String>, String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        match entry()?.get_password() {
            Ok(key) => Ok(Some(key)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Could not read the Jev credential from the system vault.".into()),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("Jev credential storage requires a supported system credential vault.".into())
    }
}
fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > 4096 || !key.bytes().all(|b| (33..=126).contains(&b)) {
        return Err("Enter a valid Jev API key without spaces.".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn get_jev_api_key(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    check_window(&window)?;
    read_key_async().await
}
async fn read_key_async() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(read_key)
        .await
        .map_err(|_| "Credential read interrupted.".to_string())?
}
#[tauri::command]
pub async fn set_jev_api_key(window: tauri::WebviewWindow, key: String) -> Result<(), String> {
    check_window(&window)?;
    validate_key(&key)?;
    cancel_all()?;
    let _credentials = CREDENTIAL_LOCK.write().await;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            entry()?
                .set_password(&key)
                .map_err(|_| "Could not save the Jev key in the system vault.".into())
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = key;
            Err("Jev credential storage requires a supported system credential vault.".into())
        }
    })
    .await
    .map_err(|_| "Credential save interrupted.".to_string())?
}
#[tauri::command]
pub async fn clear_jev_api_key(window: tauri::WebviewWindow) -> Result<(), String> {
    check_window(&window)?;
    cancel_all()?;
    let _credentials = CREDENTIAL_LOCK.write().await;
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            match entry()?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => Err("Could not remove the Jev key from the system vault.".into()),
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Err("Jev credential storage requires a supported system credential vault.".into())
        }
    })
    .await
    .map_err(|_| "Credential removal interrupted.".to_string())?
}
fn cancel_all() -> Result<(), String> {
    let mut requests = REQUESTS
        .lock()
        .map_err(|_| "Jev request state unavailable.")?;
    for sender in requests.values_mut() {
        if let Some(sender) = sender.take() {
            let _ = sender.send(());
        }
    }
    Ok(())
}
#[tauri::command]
pub fn cancel_jev_request(window: tauri::WebviewWindow, request_id: String) -> Result<(), String> {
    check_window(&window)?;
    let mut requests = REQUESTS
        .lock()
        .map_err(|_| "Jev request state unavailable.")?;
    if let Some(sender) = requests.get_mut(&request_id).and_then(Option::take) {
        let _ = sender.send(());
    }
    Ok(())
}

fn validate_payload(payload: &Value) -> Result<Vec<u8>, String> {
    let body = serde_json::to_vec(payload).map_err(|_| "Invalid Jev request.")?;
    let object = payload.as_object().ok_or("Invalid Jev request.")?;
    let questions = payload
        .get("questions")
        .and_then(Value::as_object)
        .ok_or("Invalid Jev questions.")?;
    if body.len() > MAX_BYTES
        || object.len() != 3
        || !object.contains_key("state")
        || payload.get("model").and_then(Value::as_str) != Some("jev-1.13.0")
        || questions.is_empty()
        || questions.len() > 32
        || questions
            .values()
            .any(|q| q.get("type").and_then(Value::as_str) != Some("noul"))
    {
        return Err("Jev request exceeds the supported model or question bounds.".into());
    }
    Ok(body)
}
async fn send_request(body: Vec<u8>, key: String) -> Result<Value, String> {
    send_request_to(body, key, ENDPOINT, Duration::from_secs(30)).await
}

// Only the fixed production endpoint is reachable through IPC. Tests use loopback.
async fn send_request_to(
    body: Vec<u8>,
    key: String,
    endpoint: &str,
    timeout: Duration,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(timeout)
        .build()
        .map_err(|_| "Could not initialize Jev connection.")?;
    let mut response = client
        .post(endpoint)
        .bearer_auth(key)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|_| "Could not reach Jev. Check your connection and try again.")?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "Jev rejected the API key. Check it in AI settings.",
            429 | 529 => "Jev is busy or rate limited. Wait before trying again.",
            _ => "Jev could not complete the request. No results were applied.",
        }
        .into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Jev response interrupted.")?
    {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err("Jev response exceeded its size limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Jev returned an invalid response.".into())
}

/// Keep cancelled requests in the bound until their future actually releases resources.
struct RequestSlot(String);
impl RequestSlot {
    fn acquire(request_id: String) -> Result<(Self, oneshot::Receiver<()>), String> {
        let (sender, receiver) = oneshot::channel();
        let mut active = REQUESTS
            .lock()
            .map_err(|_| "Jev request state unavailable.")?;
        if active.len() >= 4 || active.contains_key(&request_id) {
            return Err("Jev already has four requests in flight.".into());
        }
        active.insert(request_id.clone(), Some(sender));
        Ok((Self(request_id), receiver))
    }
}
impl Drop for RequestSlot {
    fn drop(&mut self) {
        if let Ok(mut active) = REQUESTS.lock() {
            active.remove(&self.0);
        }
    }
}
#[tauri::command]
pub async fn request_jev(
    window: tauri::WebviewWindow,
    request_id: String,
    payload: Value,
) -> Result<Value, String> {
    check_window(&window)?;
    if request_id.len() != 36
        || !request_id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() || b == b'-')
    {
        return Err("Invalid Jev request identity.".into());
    }
    let body = validate_payload(&payload)?;
    let budget_root = budget_root(&window)?;
    let reservation_id = request_id.clone();
    let (_slot, receiver) = RequestSlot::acquire(request_id)?;
    tokio::select! {
        _ = receiver => Err("Jev request cancelled.".into()),
        result = tokio::time::timeout(Duration::from_secs(30), async {
            // Fail closed before credential access as well as provider contact.
            tauri::async_runtime::spawn_blocking(move || crate::jev_budget::reserve(&budget_root, &reservation_id)).await.map_err(|_| "Jev budget check interrupted.".to_string())??;
            let _credentials = CREDENTIAL_LOCK.read().await;
            let key = read_key_async().await?.ok_or("Add your Jev API key in AI settings.")?;
            validate_key(&key)?;
            // No refund even for a missing key: this is conservative allowance,
            // not evidence of provider contact or an actual billed charge.
            send_request(body, key).await
        }) => result.unwrap_or_else(|_| Err("Jev request timed out.".into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn closes_request_and_credential_bounds() {
        let good = serde_json::json!({"model":"jev-1.13.0","state":{"text":"Example"},"questions":{"test":{"type":"noul","instructions":"Is this text?"}}});
        assert!(validate_payload(&good).is_ok());
        let mut bad = good.clone();
        bad["model"] = "another-model".into();
        assert!(validate_payload(&bad).is_err());
        bad = good.clone();
        bad["state"] = "x".repeat(MAX_BYTES).into();
        assert!(validate_payload(&bad).is_err());
        bad = good;
        bad["endpoint"] = "https://example.com".into();
        assert!(validate_payload(&bad).is_err());
        assert!(validate_key("test-key").is_ok());
        for key in ["", "key\nheader", "key with spaces"] {
            assert!(validate_key(key).is_err());
        }
    }
    #[tokio::test]
    async fn cancelled_requests_keep_their_slot_until_cleanup() {
        let mut slots = Vec::new();
        let mut receivers = Vec::new();
        for index in 0..4 {
            let (slot, receiver) = RequestSlot::acquire(format!("test-{index}")).unwrap();
            slots.push(slot);
            receivers.push(receiver);
        }
        assert!(RequestSlot::acquire("overflow".into()).is_err());
        cancel_all().unwrap();
        for receiver in receivers {
            assert!(receiver.await.is_ok());
        }
        assert!(RequestSlot::acquire("still-full".into()).is_err());
        slots.pop();
        let (replacement, _) = RequestSlot::acquire("replacement".into()).unwrap();
        drop(replacement);
        drop(slots);
        assert!(REQUESTS.lock().unwrap().is_empty());
    }

    async fn reply(
        status: &str,
        body: String,
        delay: Duration,
    ) -> (String, tokio::task::JoinHandle<String>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let status = status.to_owned();
        let task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buffer = vec![0; 8192];
            let count = stream.read(&mut buffer).await.unwrap();
            let request = String::from_utf8_lossy(&buffer[..count]).into_owned();
            tokio::time::sleep(delay).await;
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes()).await;
            request
        });
        (address, task)
    }

    #[tokio::test]
    async fn transport_bounds_response_and_redacts_vendor_errors() {
        for (status, body, expected) in [
            (
                "401 Unauthorized",
                "vendor echoes secret-key".into(),
                "Jev rejected the API key. Check it in AI settings.",
            ),
            (
                "429 Too Many Requests",
                "vendor echoes secret-key".into(),
                "Jev is busy or rate limited. Wait before trying again.",
            ),
            (
                "200 OK",
                "x".repeat(MAX_BYTES + 1),
                "Jev response exceeded its size limit.",
            ),
            (
                "200 OK",
                "not-json".into(),
                "Jev returned an invalid response.",
            ),
            (
                "302 Found",
                "vendor redirect".into(),
                "Jev could not complete the request. No results were applied.",
            ),
        ] {
            let (address, server) = reply(status, body, Duration::ZERO).await;
            let result = send_request_to(
                b"{}".to_vec(),
                "secret-key".into(),
                &address,
                Duration::from_secs(3),
            )
            .await;
            assert_eq!(result.unwrap_err(), expected);
            let request = server.await.unwrap().to_ascii_lowercase();
            assert!(request.starts_with("post / http/1.1"));
            assert!(request.contains("authorization: bearer secret-key"));
        }
        let (address, server) = reply("200 OK", r#"{"ok":true}"#.into(), Duration::ZERO).await;
        assert_eq!(
            send_request_to(
                b"{}".to_vec(),
                "secret-key".into(),
                &address,
                Duration::from_secs(3)
            )
            .await
            .unwrap(),
            serde_json::json!({"ok":true})
        );
        server.await.unwrap();
    }

    #[tokio::test]
    async fn transport_times_out_without_retrying() {
        let (address, server) = reply("200 OK", "{}".into(), Duration::from_millis(200)).await;
        assert!(send_request_to(
            b"{}".to_vec(),
            "secret-key".into(),
            &address,
            Duration::from_millis(20)
        )
        .await
        .is_err());
        server.abort();
    }
    #[test]
    #[cfg(feature = "isolated-preview-data-root")]
    fn unique_preview_credentials_never_read_the_existing_preview_namespace() {
        let default = "wtf.freed.ai.isolated-preview";
        assert_eq!(isolated_preview_credential_service(None).unwrap(), default);
        assert_eq!(
            isolated_preview_credential_service(Some(
                r#"{"identifier":"wtf.freed.desktop.sqlite-native-preview"}"#
            ))
            .unwrap(),
            default
        );
        let isolated = isolated_preview_credential_service(Some(
            r#"{"identifier":"wtf.freed.desktop.preview.gliclass20261002"}"#,
        ))
        .unwrap();
        assert_ne!(isolated, default);
        assert_ne!(isolated, "wtf.freed.ai");
        assert!(
            isolated_preview_credential_service(Some(r#"{"identifier":"wtf.freed.desktop"}"#))
                .is_err()
        );
    }
}

fn budget_root(window: &tauri::WebviewWindow) -> Result<std::path::PathBuf, String> {
    window
        .app_handle()
        .path()
        .app_config_dir()
        .map(|root| root.join("jev-spend"))
        .map_err(|_| "Jev budget location unavailable.".into())
}
#[tauri::command]
pub async fn get_jev_budget(
    window: tauri::WebviewWindow,
) -> Result<Option<crate::jev_budget::Status>, String> {
    check_window(&window)?;
    let root = budget_root(&window)?;
    tauri::async_runtime::spawn_blocking(move || crate::jev_budget::status(&root))
        .await
        .map_err(|_| "Jev budget check interrupted.".to_string())?
}
#[tauri::command]
pub async fn set_jev_budget(
    window: tauri::WebviewWindow,
    limits: crate::jev_budget::Limits,
) -> Result<crate::jev_budget::Status, String> {
    check_window(&window)?;
    let root = budget_root(&window)?;
    tauri::async_runtime::spawn_blocking(move || crate::jev_budget::configure(&root, limits))
        .await
        .map_err(|_| "Jev budget update interrupted.".to_string())?
}
