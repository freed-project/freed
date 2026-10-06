//! Annotation-only process owner. Each callback performs one owned bounded slice.
use crate::NormalizedAnnotationReconciliationPassV1;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

type Pass = Option<NormalizedAnnotationReconciliationPassV1>;
type Slice = dyn Fn(Pass) -> Result<(Pass, bool), AnnotationMaintenanceError> + Send + Sync;

#[derive(Clone, Copy, Debug)]
pub enum AnnotationMaintenanceError {
    Busy,
    Refused,
}

#[derive(Default)]
struct State {
    running: bool,
    dirty: bool,
    failed: bool,
    stopped: bool,
    worker: Option<JoinHandle<()>>,
}

/// Hosts stop this owner before resetting storage or shutting down. Notification
/// callbacks only report change/refusal; they must not synchronously stop it.
pub struct AnnotationMaintenanceOwner {
    state: Mutex<State>,
    lifecycle: Mutex<()>,
    slice: Arc<Slice>,
    notify: Arc<dyn Fn(bool) + Send + Sync>,
}
impl AnnotationMaintenanceOwner {
    pub fn new(
        slice: impl Fn(Pass) -> Result<(Pass, bool), AnnotationMaintenanceError> + Send + Sync + 'static,
        notify: impl Fn(bool) + Send + Sync + 'static,
    ) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State::default()),
            lifecycle: Mutex::new(()),
            slice: Arc::new(slice),
            notify: Arc::new(notify),
        })
    }
    pub fn failed(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .failed
    }
    pub fn mark_dirty(self: &Arc<Self>) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.stopped || state.failed {
            return;
        }
        state.dirty = true;
        if state.running {
            return;
        }
        state.running = true;
        let owner = Arc::clone(self);
        match std::thread::Builder::new()
            .name("freed-annotation-maintenance".into())
            .spawn(move || owner.run())
        {
            Ok(worker) => state.worker = Some(worker),
            Err(_) => {
                state.running = false;
                state.failed = true;
                drop(state);
                (self.notify)(true);
            }
        }
    }
    /// Wait for the current bounded operation to finish before the host acquires
    /// its reset gate. No old callback can touch a replacement store afterward.
    pub fn stop(&self) {
        let _lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        self.stop_inner();
    }
    fn stop_inner(&self) {
        let worker = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.stopped = true;
            state.dirty = false;
            state.worker.take()
        };
        if let Some(worker) = worker {
            let _ = worker.join();
        }
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .running = false;
    }
    /// Explicit owned startup/reset completion may clear a latched refusal.
    pub fn restart(self: &Arc<Self>) {
        let _lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        self.stop_inner();
        {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.stopped = false;
            state.failed = false;
        }
        self.mark_dirty();
    }
    fn run(&self) {
        let mut pass = None;
        loop {
            {
                let mut state = self
                    .state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if state.stopped {
                    state.running = false;
                    return;
                }
                if pass.is_none() {
                    if !state.dirty {
                        state.running = false;
                        return;
                    }
                    state.dirty = false;
                }
            }
            match (self.slice)(pass.clone()) {
                Ok((next, changed)) => {
                    pass = next;
                    if changed {
                        (self.notify)(false);
                    }
                }
                Err(AnnotationMaintenanceError::Busy) => {
                    self.state
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .dirty = true;
                    std::thread::sleep(Duration::from_millis(25));
                    continue;
                }
                Err(AnnotationMaintenanceError::Refused) => {
                    {
                        let mut state = self
                            .state
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                        state.running = false;
                        state.failed = true;
                    }
                    (self.notify)(true);
                    return;
                }
            }
            // The host has released the connection and reset gate before return.
            std::thread::sleep(Duration::from_millis(1));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc,
    };
    use std::time::Instant;
    fn until(mut ready: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(3);
        while !ready() {
            assert!(Instant::now() < deadline, "annotation owner did not settle");
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    fn idle(owner: &AnnotationMaintenanceOwner) {
        until(|| !owner.state.lock().unwrap().running);
    }

    // These tests execute the shipping std-thread owner with controlled slice
    // callbacks. Real selected-binding/SQLite operations have separate fixtures.
    #[test]
    fn annotation_owner_coalesces_dirty_arrivals_and_stops_after_clean_pass() {
        let (entered, seen) = mpsc::channel();
        let (release, wait) = mpsc::channel();
        let wait = Mutex::new(wait);
        let calls = Arc::new(AtomicUsize::new(0));
        let count = calls.clone();
        let changes = Arc::new(AtomicUsize::new(0));
        let notify = changes.clone();
        let owner = AnnotationMaintenanceOwner::new(
            move |_| {
                let call = count.fetch_add(1, Ordering::SeqCst);
                if call == 0 {
                    entered.send(()).unwrap();
                    wait.lock().unwrap().recv().unwrap();
                }
                Ok((None, true))
            },
            move |failed| {
                assert!(!failed);
                notify.fetch_add(1, Ordering::SeqCst);
            },
        );
        owner.mark_dirty();
        seen.recv_timeout(Duration::from_secs(3)).unwrap();
        for _ in 0..20 {
            owner.mark_dirty();
        }
        release.send(()).unwrap();
        idle(&owner);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(changes.load(Ordering::SeqCst), 2);
        std::thread::sleep(Duration::from_millis(30));
        assert_eq!(
            calls.load(Ordering::SeqCst),
            2,
            "idle unresolved state cannot spin"
        );
        owner.stop();
    }
    #[test]
    fn annotation_owner_defers_busy_then_latches_refusal_until_explicit_restart() {
        let calls = Arc::new(AtomicUsize::new(0));
        let count = calls.clone();
        let corrupt = Arc::new(AtomicBool::new(true));
        let failure = corrupt.clone();
        let owner = AnnotationMaintenanceOwner::new(
            move |_| {
                if count.fetch_add(1, Ordering::SeqCst) == 0 {
                    return Err(AnnotationMaintenanceError::Busy);
                }
                if failure.load(Ordering::SeqCst) {
                    Err(AnnotationMaintenanceError::Refused)
                } else {
                    Ok((None, false))
                }
            },
            |_| {},
        );
        owner.mark_dirty();
        until(|| owner.failed());
        idle(&owner);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        owner.mark_dirty();
        std::thread::sleep(Duration::from_millis(30));
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        corrupt.store(false, Ordering::SeqCst);
        owner.restart();
        idle(&owner);
        assert!(!owner.failed());
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        owner.stop();
    }
    #[test]
    fn annotation_owner_stop_joins_current_slice_before_reset_and_discards_old_dirty_work() {
        let (entered, seen) = mpsc::channel();
        let (release, wait) = mpsc::channel();
        let wait = Mutex::new(wait);
        let generation = Arc::new(AtomicUsize::new(1));
        let current = generation.clone();
        let visited = Arc::new(Mutex::new(Vec::new()));
        let history = visited.clone();
        let owner = AnnotationMaintenanceOwner::new(
            move |_| {
                let value = current.load(Ordering::SeqCst);
                history.lock().unwrap().push(value);
                if value == 1 {
                    entered.send(()).unwrap();
                    wait.lock().unwrap().recv().unwrap();
                }
                Ok((None, false))
            },
            |_| {},
        );
        owner.mark_dirty();
        seen.recv_timeout(Duration::from_secs(3)).unwrap();
        owner.mark_dirty();
        let stopping = owner.clone();
        let (finished, done) = mpsc::channel();
        let shutdown = std::thread::spawn(move || {
            stopping.stop();
            finished.send(()).unwrap();
        });
        until(|| owner.state.lock().unwrap().stopped);
        assert!(done.try_recv().is_err());
        owner.mark_dirty();
        release.send(()).unwrap();
        done.recv_timeout(Duration::from_secs(3)).unwrap();
        shutdown.join().unwrap();
        generation.store(2, Ordering::SeqCst);
        owner.mark_dirty();
        assert_eq!(*visited.lock().unwrap(), vec![1]);
        owner.restart();
        idle(&owner);
        owner.stop();
        assert_eq!(*visited.lock().unwrap(), vec![1, 2]);
    }
}
