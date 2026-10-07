//! Optional local classifier. No credentials, proxies, redirects, retries or cloud route.
use serde_json::Value;
use std::{
    sync::{LazyLock, Mutex},
    time::Duration,
};
use tokio::sync::oneshot;

const ORIGIN: &str = "http://127.0.0.1:8009";
const MAX_BYTES: usize = 64 * 1024;
type ActiveRequest = Option<(String, Option<oneshot::Sender<()>>)>;
static ACTIVE: LazyLock<Mutex<ActiveRequest>> = LazyLock::new(|| Mutex::new(None));

fn check_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Kev is available only from the main Freed window.".into());
    }
    Ok(())
}
fn validate_payload(payload: &Value) -> Result<Vec<u8>, String> {
    let body = serde_json::to_vec(payload).map_err(|_| "Invalid Kev request.")?;
    let object = payload.as_object().ok_or("Invalid Kev request.")?;
    let questions = payload
        .get("questions")
        .and_then(Value::as_object)
        .ok_or("Invalid Kev questions.")?;
    if body.len() > MAX_BYTES
        || object.len() != 3
        || !object.contains_key("state")
        || payload.get("model").and_then(Value::as_str) != Some("kev-latest")
        || questions.is_empty()
        || questions.len() > 32
        || questions
            .values()
            .any(|q| q.get("type").and_then(Value::as_str) != Some("noul"))
    {
        return Err("Kev request exceeds the supported model or question bounds.".into());
    }
    Ok(body)
}

async fn transport(
    endpoint: &str,
    body: Option<Vec<u8>>,
    timeout: Duration,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(timeout)
        .build()
        .map_err(|_| "Could not initialize local Kev connection.")?;
    let request = match body {
        Some(body) => client
            .post(endpoint)
            .header("Content-Type", "application/json")
            .body(body),
        None => client.get(endpoint),
    };
    let mut response = request.send().await.map_err(|_| {
        "Could not reach local Kev. Start the server on 127.0.0.1:8009 and try again."
    })?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            422 => "Kev abstained: input exceeds the local model limits.",
            401 | 403 => "Local Kev requires authentication. This integration expects a loopback-only server without an API key.",
            _ => "Local Kev could not complete the request. No cloud fallback was used.",
        }.into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Local Kev response interrupted.")?
    {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err("Local Kev response exceeded its size limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Local Kev returned invalid JSON.".into())
}

struct Slot;
impl Drop for Slot {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.lock() {
            *active = None;
        }
    }
}
fn acquire(id: String) -> Result<(Slot, oneshot::Receiver<()>), String> {
    let mut active = ACTIVE
        .lock()
        .map_err(|_| "Local Kev request state unavailable.")?;
    if active.is_some() {
        return Err("Kev is busy. Wait for the current classification to finish.".into());
    }
    let (sender, receiver) = oneshot::channel();
    *active = Some((id, Some(sender)));
    Ok((Slot, receiver))
}

#[tauri::command]
pub async fn get_kev_models(window: tauri::WebviewWindow) -> Result<Value, String> {
    check_window(&window)?;
    transport(&format!("{ORIGIN}/v1/models"), None, Duration::from_secs(3)).await
}
#[tauri::command]
pub fn cancel_kev_request(window: tauri::WebviewWindow, request_id: String) -> Result<(), String> {
    check_window(&window)?;
    let mut active = ACTIVE
        .lock()
        .map_err(|_| "Local Kev request state unavailable.")?;
    if let Some((id, sender)) = active.as_mut() {
        if id == &request_id {
            if let Some(sender) = sender.take() {
                let _ = sender.send(());
            }
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn request_kev(
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
        return Err("Invalid Kev request identity.".into());
    }
    let body = validate_payload(&payload)?;
    let (_slot, cancelled) = acquire(request_id)?;
    let endpoint = format!("{ORIGIN}/v1/systemone");
    tokio::select! {
        _ = cancelled => Err("Local Kev request cancelled.".into()),
        result = transport(&endpoint, Some(body), Duration::from_secs(60)) => result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_payload_and_keeps_cancelled_slot_until_cleanup() {
        let good = serde_json::json!({"model":"kev-latest","state":"Example","questions":{"q":{"type":"noul"}}});
        assert!(validate_payload(&good).is_ok());
        for (key, value) in [
            ("model", Value::from("jev-latest")),
            ("endpoint", Value::from("https://example.com")),
            ("state", Value::from("x".repeat(MAX_BYTES))),
        ] {
            let mut bad = good.clone();
            bad[key] = value;
            assert!(validate_payload(&bad).is_err());
        }
        let (slot, _) = acquire("first".into()).unwrap();
        assert!(acquire("second".into()).is_err());
        ACTIVE.lock().unwrap().as_mut().unwrap().1.take();
        assert!(acquire("cancelled-but-held".into()).is_err());
        drop(slot);
        assert!(acquire("released".into()).is_ok());
    }
    #[tokio::test]
    async fn local_transport_bounds_errors_and_never_follows_redirects() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        for (status, body, success) in [
            ("200 OK", "{\"ok\":true}".to_owned(), true),
            ("302 Found", "private text".into(), false),
            ("422 Unprocessable Entity", "private text".into(), false),
            ("200 OK", "x".repeat(MAX_BYTES + 1), false),
        ] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = format!("http://{}/v1/systemone", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = vec![0; 8192];
                let size = stream.read(&mut request).await.unwrap();
                let request = String::from_utf8_lossy(&request[..size]).to_lowercase();
                assert!(!request.contains("authorization:"));
                assert!(request.starts_with("post /v1/systemone"));
                let response = format!("HTTP/1.1 {status}\r\nLocation: http://127.0.0.1:1/forbidden\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                let _ = stream.write_all(response.as_bytes()).await;
            });
            let result = transport(&address, Some(b"{}".to_vec()), Duration::from_secs(2)).await;
            assert_eq!(result.is_ok(), success);
            if let Err(error) = result {
                assert!(!error.contains("private text"));
                if status == "302 Found" {
                    assert_eq!(
                        error,
                        "Local Kev could not complete the request. No cloud fallback was used."
                    );
                }
            }
            server.await.unwrap();
        }
    }
}
