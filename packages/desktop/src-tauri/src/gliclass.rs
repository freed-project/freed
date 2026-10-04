//! Optional local GLiClass. No endpoint, credential, or content telemetry.
use ort::{
    session::{RunOptions, Session},
    value::Tensor,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::{
    io::Read,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, LazyLock, Mutex,
    },
    time::Instant,
};
use tauri::Manager;
use tokenizers::Tokenizer;
const REVISION: &str = "77a70e6cd52e602ed18184ef37d18bdd3741e3d5";
const GRAPH: &[u8] = include_bytes!("../models/gliclass-base/model.onnx");
static BUSY: AtomicBool = AtomicBool::new(false);
static CANCELLED: LazyLock<Mutex<VecDeque<String>>> = LazyLock::new(|| Mutex::new(VecDeque::new()));
static SESSION: LazyLock<Mutex<Option<Runtime>>> = LazyLock::new(|| Mutex::new(None));
type ActiveRun = (String, Arc<AtomicBool>, Arc<RunOptions>);
static ACTIVE: LazyLock<Mutex<Option<ActiveRun>>> = LazyLock::new(|| Mutex::new(None));
static IDLE: LazyLock<Mutex<Option<tokio::task::JoinHandle<()>>>> =
    LazyLock::new(|| Mutex::new(None));
struct Runtime {
    tokenizer: Tokenizer,
    session: Session,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    text: String,
    labels: Vec<String>,
    model_revision: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    model_revision: &'static str,
    logits: Vec<f32>,
    truncated: bool,
    token_count: usize,
    elapsed_ms: f64,
}
struct Drain;
impl Drop for Drain {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.lock() {
            *active = None;
        }
        BUSY.store(false, Ordering::Release);
    }
}
fn verify(path: &Path, bytes: u64, digest: &str) -> Result<(), String> {
    let mut f = std::fs::File::open(path)
        .map_err(|_| "Download GLiClass Base before classifying offline.")?;
    if f.metadata()
        .map_err(|_| "Could not inspect the local model.")?
        .len()
        != bytes
    {
        return Err("GLiClass model integrity check failed. Remove and download it again.".into());
    }
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = f
            .read(&mut buffer)
            .map_err(|_| "Could not verify the local model.")?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    if hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>()
        != digest
    {
        return Err("GLiClass model integrity check failed. Remove and download it again.".into());
    }
    Ok(())
}
fn load(root: &Path) -> Result<Runtime, String> {
    verify(
        &root.join("model.safetensors"),
        746211800,
        "4f1043b82812a8f5ec7ff9f97c6744758f47836f9872ba0dbeb3a8e2b0b92a26",
    )?;
    verify(
        &root.join("tokenizer.json"),
        8649234,
        "519648948c4c59da1af88f2cf2c8b4f84417b5c673981bc9809abf84cda1b7cc",
    )?;
    std::fs::write(root.join("model.onnx"), GRAPH)
        .map_err(|_| "Could not prepare the local GLiClass graph.")?;
    let tokenizer = Tokenizer::from_file(root.join("tokenizer.json"))
        .map_err(|_| "Could not load the GLiClass tokenizer.")?;
    if tokenizer.token_to_id("<<LABEL>>") != Some(128001)
        || tokenizer.token_to_id("<<SEP>>") != Some(128002)
    {
        return Err("GLiClass tokenizer identity mismatch.".into());
    }
    let session = Session::builder()
        .and_then(|b| b.with_intra_threads(1))
        .and_then(|b| b.with_inter_threads(1))
        .and_then(|b| b.commit_from_file(root.join("model.onnx")))
        .map_err(|_| "Could not load the local GLiClass runtime.")?;
    Ok(Runtime { tokenizer, session })
}
fn validate(input: &Input) -> Result<(), String> {
    if input.model_revision != REVISION
        || input.text.trim().is_empty()
        || input.text.len() > 40000
        || input.text.contains("<<")
        || input.labels.is_empty()
        || input.labels.len() > 25
        || input
            .labels
            .iter()
            .any(|s| s.trim().is_empty() || s.len() > 256 || s.contains("<<"))
    {
        return Err("Invalid bounded GLiClass input.".into());
    }
    Ok(())
}
fn infer(runtime: &mut Runtime, input: Input, options: &RunOptions) -> Result<Output, String> {
    let start = Instant::now();
    let mut prompt = String::new();
    for label in &input.labels {
        prompt.push_str("<<LABEL>>");
        prompt.push_str(label);
    }
    prompt.push_str("<<SEP>>");
    prompt.push_str(&input.text);
    let encoding = runtime
        .tokenizer
        .encode(prompt, true)
        .map_err(|_| "GLiClass tokenization failed.")?;
    let ids = encoding.get_ids();
    if ids.len() > 512 || ids.iter().filter(|id| **id == 128001).count() != input.labels.len() {
        return Err("GLiClass abstained: evidence or labels exceed the token limit.".into());
    }
    let ids_tensor = Tensor::from_array((
        [1, ids.len()],
        ids.iter().map(|x| *x as i64).collect::<Vec<_>>(),
    ))
    .map_err(|_| "GLiClass input allocation failed.")?;
    let mask = Tensor::from_array((
        [1, ids.len()],
        encoding
            .get_attention_mask()
            .iter()
            .map(|x| *x as i64)
            .collect::<Vec<_>>(),
    ))
    .map_err(|_| "GLiClass input allocation failed.")?;
    let output = runtime
        .session
        .run_with_options(
            ort::inputs!["input_ids"=>ids_tensor,"attention_mask"=>mask],
            options,
        )
        .map_err(|_| "Local GLiClass inference stopped or failed.")?;
    let (shape, scores) = output["logits"]
        .try_extract_tensor::<f32>()
        .map_err(|_| "GLiClass returned invalid logits.")?;
    if **shape != [1, 25] || !scores.iter().all(|x| x.is_finite()) {
        return Err("GLiClass returned invalid logits.".into());
    }
    Ok(Output {
        model_revision: REVISION,
        logits: scores[..input.labels.len()].to_vec(),
        truncated: false,
        token_count: ids.len(),
        elapsed_ms: start.elapsed().as_secs_f64() * 1000.,
    })
}
fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        Err("GLiClass is available only in the main Freed window.".into())
    } else {
        Ok(())
    }
}
#[tauri::command]
pub async fn request_gliclass(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    request_id: String,
    input: Input,
) -> Result<Output, String> {
    main_window(&window)?;
    validate(&input)?;
    if request_id.is_empty()
        || request_id.len() > 64
        || !request_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("Invalid local request identity.".into());
    }
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "Local model storage is unavailable.")?
        .join("local-ai-models/gliclass-base")
        .join(REVISION);
    let options = Arc::new(RunOptions::new().map_err(|_| "Local runtime is unavailable.")?);
    let cancelled = Arc::new(AtomicBool::new(false));
    if BUSY
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("GLiClass is busy. Wait for the current classification to finish.".into());
    }
    let drain = Drain;
    {
        let mut active = ACTIVE.lock().map_err(|_| "Local runtime is unavailable.")?;
        let mut earlier = CANCELLED
            .lock()
            .map_err(|_| "Local runtime is unavailable.")?;
        if let Some(index) = earlier.iter().position(|id| *id == request_id) {
            earlier.remove(index);
            return Err("Local classification cancelled.".into());
        }
        *active = Some((request_id, cancelled.clone(), options.clone()));
    }
    let work_options = options.clone();
    let work_cancelled = cancelled.clone();
    let mut task = tauri::async_runtime::spawn_blocking(move || {
        let _drain = drain;
        let mut state = SESSION
            .lock()
            .map_err(|_| "Local runtime is unavailable.")?;
        if work_cancelled.load(Ordering::Acquire) {
            return Err("Local classification cancelled.".into());
        }
        if state.is_none() {
            *state = Some(load(&root)?);
        }
        if work_cancelled.load(Ordering::Acquire) {
            return Err("Local classification cancelled.".into());
        }
        infer(state.as_mut().unwrap(), input, &work_options)
    });
    let result = tokio::select! { value=&mut task=>value.map_err(|_|"Local classifier worker failed.")?, _=tokio::time::sleep(std::time::Duration::from_secs(30))=>{cancelled.store(true,Ordering::Release);let _=options.terminate();let _=task.await;Err("Local classification exceeded its time limit.".into())} };
    if let Ok(mut idle) = IDLE.lock() {
        if let Some(old) = idle.take() {
            old.abort();
        }
        *idle = Some(tokio::spawn(async {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            let _ = tauri::async_runtime::spawn_blocking(|| {
                if !BUSY.load(Ordering::Acquire) {
                    if let Ok(mut state) = SESSION.try_lock() {
                        *state = None;
                    }
                }
            })
            .await;
        }));
    }
    if cancelled.load(Ordering::Acquire) {
        Err("Local classification cancelled.".into())
    } else {
        result
    }
}
#[tauri::command]
pub async fn cancel_gliclass_request(
    window: tauri::WebviewWindow,
    request_id: String,
) -> Result<(), String> {
    main_window(&window)?;
    if request_id.is_empty()
        || request_id.len() > 64
        || !request_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("Invalid local request identity.".into());
    }
    let active = ACTIVE.lock().map_err(|_| "Local runtime unavailable.")?;
    if let Some((id, cancelled, options)) = active.as_ref() {
        if *id == request_id {
            cancelled.store(true, Ordering::Release);
            let _ = options.terminate();
            return Ok(());
        }
    }
    let mut earlier = CANCELLED.lock().map_err(|_| "Local runtime unavailable.")?;
    if !earlier.contains(&request_id) {
        if earlier.len() >= 64 {
            earlier.pop_front();
        }
        earlier.push_back(request_id);
    }
    Ok(())
}
#[tauri::command]
pub async fn unload_gliclass(window: tauri::WebviewWindow) -> Result<(), String> {
    main_window(&window)?;
    if BUSY.load(Ordering::Acquire) {
        return Err("Stop classification before removing the local model.".into());
    }
    tauri::async_runtime::spawn_blocking(|| {
        let mut state = SESSION.lock().map_err(|_| "Local runtime unavailable.")?;
        *state = None;
        Ok(())
    })
    .await
    .map_err(|_| "Local worker failed.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn verifier_refuses_size_and_digest_mismatches() {
        use std::io::Write;
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(b"synthetic checkpoint").unwrap();
        let digest = Sha256::digest(b"synthetic checkpoint")
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        assert!(verify(file.path(), 20, &digest).is_ok());
        assert!(verify(file.path(), 21, &digest).is_err());
        assert!(verify(file.path(), 20, &"0".repeat(64)).is_err());
    }
    #[test]
    fn native_input_bounds_and_delimiters_are_enforced() {
        let make = |text: &str, count: usize| Input {
            text: text.into(),
            labels: vec!["synthetic label".into(); count],
            model_revision: REVISION.into(),
        };
        assert!(validate(&make("synthetic text", 25)).is_ok());
        assert!(validate(&make("synthetic text", 26)).is_err());
        assert!(validate(&make("<<LABEL>>injected", 1)).is_err());
        assert!(validate(&make("", 1)).is_err());
        assert!(validate(&make(&"x".repeat(40001), 1)).is_err());
    }
}
