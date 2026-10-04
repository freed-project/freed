//! Checkpoint session replacement boundaries, without diagnostics or SQL policy.
use std::sync::Mutex;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Stage {
    Acquire,
    Replace,
}

/// Observe acquisition separately from dropping the previous pinned session.
/// The guard is released before returning, including on replacement unwind.
pub(super) fn replace<T>(
    session: &Mutex<Option<T>>,
    replacement: impl FnOnce() -> T,
    mut observe: impl FnMut(Stage),
) -> Result<(), &'static str> {
    observe(Stage::Acquire);
    let mut guard = session
        .lock()
        .map_err(|_| "normalized checkpoint export session lock failed")?;
    observe(Stage::Replace);
    *guard = Some(replacement());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, TryLockError};

    #[test]
    fn acquisition_waits_then_replacement_drops_old_session_under_guard() {
        let session = Mutex::new(Some(1));
        let (entered_tx, entered_rx) = mpsc::channel();
        let guard = session.lock().unwrap();
        std::thread::scope(|threads| {
            let worker = threads.spawn(|| {
                let mut stages = Vec::new();
                replace(
                    &session,
                    || 2,
                    |stage| {
                        stages.push(stage);
                        if stage == Stage::Acquire {
                            entered_tx.send(()).unwrap();
                        } else {
                            assert!(matches!(session.try_lock(), Err(TryLockError::WouldBlock)));
                        }
                    },
                )
                .unwrap();
                assert_eq!(stages, [Stage::Acquire, Stage::Replace]);
            });
            entered_rx.recv().unwrap();
            assert_eq!(*guard, Some(1));
            drop(guard);
            worker.join().unwrap();
        });
        assert_eq!(*session.try_lock().unwrap(), Some(2));
    }

    #[test]
    fn replacement_finishes_old_drop_before_guard_release() {
        use std::cell::Cell;
        struct Probe<'a>(&'a Cell<usize>);
        impl Drop for Probe<'_> {
            fn drop(&mut self) {
                self.0.set(self.0.get() + 1);
            }
        }
        let drops = Cell::new(0);
        let session = Mutex::new(Some(Probe(&drops)));
        replace(
            &session,
            || Probe(&drops),
            |stage| {
                if stage == Stage::Replace {
                    assert_eq!(drops.get(), 0);
                }
            },
        )
        .unwrap();
        assert_eq!(drops.get(), 1);
        assert!(session.try_lock().is_ok());
        drop(session);
        assert_eq!(drops.get(), 2);
    }

    #[test]
    fn poisoned_session_preserves_error_and_never_replaces() {
        let session = Mutex::new(Some(1));
        let _ = std::panic::catch_unwind(|| {
            let _guard = session.lock().unwrap();
            panic!("poison");
        });
        let mut stages = Vec::new();
        assert_eq!(
            replace(&session, || 2, |s| stages.push(s)),
            Err("normalized checkpoint export session lock failed")
        );
        assert_eq!(stages, [Stage::Acquire]);
        assert_eq!(*session.lock().unwrap_err().into_inner(), Some(1));
    }

    #[test]
    fn terminal_summary_occurs_after_session_guard_release_and_includes_old_drop() {
        use std::cell::{Cell, RefCell};
        use std::sync::{Mutex, TryLockError};
        struct Probe<'a>(&'a Cell<u64>);
        impl Drop for Probe<'_> {
            fn drop(&mut self) {
                self.0.set(self.0.get() + 15);
            }
        }
        let now = Cell::new(0);
        let state = Mutex::new(Some(Probe(&now)));
        let events = RefCell::new(Vec::new());
        let limiter = crate::library_core_native_timings::test_limiter();
        let result: Result<(), &'static str> = crate::library_core_native_timings::with_trace(
            crate::library_core_native_timings::Scope::CheckpointPrepare,
            true,
            &limiter,
            || now.get(),
            |event| {
                assert!(state.try_lock().is_ok());
                events.borrow_mut().push(event);
            },
            |trace| {
                replace(
                    &state,
                    || Probe(&now),
                    |stage| {
                        if stage == Stage::Acquire {
                            trace.stage(crate::library_core_native_timings::Stage::SessionLock);
                            now.set(10);
                        } else {
                            assert!(matches!(state.try_lock(), Err(TryLockError::WouldBlock)));
                            trace.stage(
                                crate::library_core_native_timings::Stage::SessionReplacement,
                            );
                        }
                    },
                )
            },
        );
        assert_eq!(result, Ok(()));
        let events = events.borrow();
        assert_eq!(events.len(), 2);
        assert_eq!(
            events[1].durations_us[crate::library_core_native_timings::Stage::SessionLock as usize],
            10
        );
        assert_eq!(
            events[1].durations_us
                [crate::library_core_native_timings::Stage::SessionReplacement as usize],
            15
        );
    }
}
