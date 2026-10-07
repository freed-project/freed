//! Bounded reader ownership. Mutation and transfer jobs do not use this registry.
use freed_library_core::NormalizedQueryControl;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::sync::{Notify, Semaphore};

const MAX_READERS: usize = 64;
const QUERY_TIMEOUT: Duration = Duration::from_secs(30);
struct Reader {
    control: Arc<NormalizedQueryControl>,
    cancelled: Notify,
    deadline: Instant,
}
#[derive(Default)]
struct Registry(Mutex<HashMap<String, Arc<Reader>>>);
fn registry() -> &'static Arc<Registry> {
    static REGISTRY: OnceLock<Arc<Registry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Arc::new(Registry::default()))
}
struct Lease {
    id: String,
    reader: Arc<Reader>,
    registry: Arc<Registry>,
}
impl Registry {
    fn begin(self: &Arc<Self>, timeout: Duration) -> Result<Lease, String> {
        let mut readers = self.0.lock().map_err(|_| "query registry poisoned")?;
        if readers.len() >= MAX_READERS {
            return Err("QUERY_CAPACITY".into());
        }
        let id = format!("{:032x}", rand::random::<u128>());
        if readers.contains_key(&id) {
            return Err("query ticket collision".into());
        }
        let deadline = Instant::now() + timeout;
        let reader = Arc::new(Reader {
            control: Arc::new(NormalizedQueryControl::new(deadline)),
            cancelled: Notify::new(),
            deadline,
        });
        readers.insert(id.clone(), Arc::clone(&reader));
        Ok(Lease {
            id,
            reader,
            registry: Arc::clone(self),
        })
    }
    fn cancel(&self, id: &str) -> Result<bool, String> {
        if id.len() != 32 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("invalid query cancellation ticket".into());
        }
        let readers = self.0.lock().map_err(|_| "query registry poisoned")?;
        let Some(reader) = readers.get(id) else {
            return Ok(false);
        };
        reader.control.cancel();
        reader.cancelled.notify_one();
        Ok(true)
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut readers) = self.registry.0.lock() {
            readers.remove(&self.id);
        }
    }
}
impl Lease {
    async fn run<T: Send + 'static>(
        self,
        permits: Arc<Semaphore>,
        read: impl FnOnce(Arc<NormalizedQueryControl>) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        self.reader.control.check()?;
        let permit = tokio::select! {
            biased;
            _ = self.reader.cancelled.notified() => return Err("QUERY_CANCELLED".into()),
            _ = tokio::time::sleep_until(self.reader.deadline.into()) => return Err("QUERY_DEADLINE".into()),
            permit = permits.acquire_owned() => permit.map_err(|_| "query limiter closed")?,
        };
        self.reader.control.check()?;
        tauri::async_runtime::spawn_blocking(move || {
            // Keep both ownership records inside the worker. Dropping the IPC
            // future must never admit another reader while this one still runs.
            let _permit = permit;
            let _lease = self;
            _lease.reader.control.check()?;
            let result = read(Arc::clone(&_lease.reader.control));
            _lease.reader.control.check()?;
            result
        })
        .await
        .map_err(|error| format!("query worker failed: {error}"))?
    }
}

pub(super) async fn run<T: Send + 'static>(
    permits: Arc<Semaphore>,
    started: Option<tauri::ipc::Channel<String>>,
    read: impl FnOnce(Arc<NormalizedQueryControl>) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let lease = registry().begin(QUERY_TIMEOUT)?;
    if let Some(started) = started {
        // Acknowledge registration before the renderer can cancel. A close
        // before this message is retained by its AbortSignal, not a tombstone.
        started
            .send(lease.id.clone())
            .map_err(|error| error.to_string())?;
    }
    lease.run(permits, read).await
}

#[tauri::command]
pub(super) fn cancel_normalized_library_query(ticket: String) -> Result<bool, String> {
    registry().cancel(&ticket)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn queued_readers_cancel_expire_and_release_capacity_without_running() {
        tauri::async_runtime::block_on(async {
            let registry = Arc::new(Registry::default());
            let lease = registry.begin(QUERY_TIMEOUT).unwrap();
            let id = lease.id.clone();
            assert!(registry.cancel(&id).unwrap());
            assert_eq!(
                lease
                    .run(Arc::new(Semaphore::new(0)), |_| -> Result<(), String> {
                        panic!("cancelled reader ran")
                    })
                    .await
                    .unwrap_err(),
                "QUERY_CANCELLED"
            );
            assert!(!registry.cancel(&id).unwrap());
            let waiting = registry.begin(QUERY_TIMEOUT).unwrap();
            let waiting_id = waiting.id.clone();
            let mut wait = std::pin::pin!(waiting
                .run(Arc::new(Semaphore::new(0)), |_| -> Result<(), String> {
                    panic!("queued cancelled reader ran")
                }));
            assert!(futures_util::poll!(&mut wait).is_pending());
            assert!(registry.cancel(&waiting_id).unwrap());
            assert_eq!(wait.await.unwrap_err(), "QUERY_CANCELLED");
            let lease = registry.begin(Duration::ZERO).unwrap();
            assert_eq!(
                lease
                    .run(Arc::new(Semaphore::new(0)), |_| -> Result<(), String> {
                        panic!("expired reader ran")
                    })
                    .await
                    .unwrap_err(),
                "QUERY_DEADLINE"
            );
            let leases: Vec<_> = (0..MAX_READERS)
                .map(|_| registry.begin(QUERY_TIMEOUT).unwrap())
                .collect();
            assert!(registry.begin(QUERY_TIMEOUT).is_err());
            drop(leases);
            assert!(registry.0.lock().unwrap().is_empty());
            let lease = registry.begin(QUERY_TIMEOUT).unwrap();
            assert_eq!(
                lease
                    .run(Arc::new(Semaphore::new(1)), |_| Ok(7))
                    .await
                    .unwrap(),
                7
            );
            assert!(registry.0.lock().unwrap().is_empty());
            let permits = Arc::new(Semaphore::new(1));
            let lease = registry.begin(QUERY_TIMEOUT).unwrap();
            let id = lease.id.clone();
            let (entered, entered_rx) = tokio::sync::oneshot::channel();
            let (release, release_rx) = std::sync::mpsc::channel();
            let task = tokio::spawn(lease.run(Arc::clone(&permits), move |control| {
                entered.send(()).unwrap();
                release_rx.recv().unwrap();
                assert_eq!(control.check(), Err("QUERY_CANCELLED"));
                Ok(())
            }));
            entered_rx.await.unwrap();
            task.abort();
            assert!(task.await.unwrap_err().is_cancelled());
            assert_eq!(permits.available_permits(), 0);
            assert!(registry.cancel(&id).unwrap());
            release.send(()).unwrap();
            let _finished = permits.acquire().await.unwrap();
            assert!(registry.0.lock().unwrap().is_empty());
        });
    }
}
