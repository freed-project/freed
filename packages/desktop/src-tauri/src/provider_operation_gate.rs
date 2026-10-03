//! Native operation lifetime barrier for cooperative authority transfer.
//! This tracks admitted native work, not persistent WebViews or renderer work.

use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use tokio::sync::{OwnedRwLockReadGuard, OwnedRwLockWriteGuard, RwLock};

/// Attempt every closure so one failed window does not leave the others active.
/// Errors remain fatal to handoff preparation, even if a later observation finds
/// that the window disappeared independently.
pub(crate) fn request_window_closure(
    labels: &[&str],
    mut close: impl FnMut(&str) -> Result<(), String>,
) -> Result<(), String> {
    let mut errors = Vec::new();
    for label in labels {
        if let Err(error) = close(label) {
            errors.push(format!("{label}: {error}"));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Provider windows could not close for authority transfer: {}",
            errors.join("; ")
        ))
    }
}

// Keep JSON counters exactly representable by renderer and collector readers.
const MAX_EVIDENCE_COUNTER: u64 = 9_007_199_254_740_991;

struct AdmissionCounters {
    instance_id: String,
    admitted: AtomicU64,
    completed: AtomicU64,
    overflowed: AtomicBool,
}

impl AdmissionCounters {
    fn increment(&self, counter: &AtomicU64) {
        if counter
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |value| {
                (value < MAX_EVIDENCE_COUNTER).then(|| value + 1)
            })
            .is_err()
        {
            // Diagnostics must not change admission or wrap back to false zero.
            self.overflowed.store(true, Ordering::SeqCst);
        }
    }
}

#[derive(Clone)]
pub(crate) struct ProviderOperationGate {
    barrier: Arc<RwLock<()>>,
    counters: Arc<AdmissionCounters>,
}

impl Default for ProviderOperationGate {
    fn default() -> Self {
        Self {
            barrier: Arc::new(RwLock::new(())),
            counters: Arc::new(AdmissionCounters {
                instance_id: format!("{:032x}", rand::random::<u128>()),
                admitted: AtomicU64::new(0),
                completed: AtomicU64::new(0),
                overflowed: AtomicBool::new(false),
            }),
        }
    }
}

/// A reservation has not passed native authority verification yet.
pub(crate) struct ProviderOperationReservation {
    permit: OwnedRwLockReadGuard<()>,
    counters: Arc<AdmissionCounters>,
}

impl ProviderOperationReservation {
    pub(crate) fn admit(self) -> AdmittedProviderOperation {
        self.counters.increment(&self.counters.admitted);
        AdmittedProviderOperation {
            _permit: self.permit,
            counters: self.counters,
        }
    }
}

pub(crate) struct AdmittedProviderOperation {
    _permit: OwnedRwLockReadGuard<()>,
    counters: Arc<AdmissionCounters>,
}

impl Drop for AdmittedProviderOperation {
    fn drop(&mut self) {
        self.counters.increment(&self.counters.completed);
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderOperationSnapshot {
    schema_version: u8,
    instance_id: String,
    admitted: u64,
    completed: u64,
    active: Option<u64>,
    healthy: bool,
}

impl ProviderOperationGate {
    pub(crate) fn try_begin(&self) -> Result<ProviderOperationReservation, String> {
        let permit = self.barrier.clone().try_read_owned().map_err(|_| {
            "Provider activity is paused while the Library prepares an authority transfer."
                .to_string()
        })?;
        Ok(ProviderOperationReservation {
            permit,
            counters: self.counters.clone(),
        })
    }

    /// Lifetime counters cover admitted native commands, not their network request
    /// count or persistent WebViews. A concurrent or saturated sample is unusable
    /// as absence evidence; no diagnostic read takes the admission barrier.
    pub(crate) fn snapshot(&self) -> ProviderOperationSnapshot {
        let admitted = self.counters.admitted.load(Ordering::SeqCst);
        let completed = self.counters.completed.load(Ordering::SeqCst);
        let stable = admitted == self.counters.admitted.load(Ordering::SeqCst);
        let active = admitted.checked_sub(completed);
        ProviderOperationSnapshot {
            schema_version: 1,
            instance_id: self.counters.instance_id.clone(),
            admitted,
            completed,
            active,
            healthy: stable
                && active.is_some()
                && admitted < MAX_EVIDENCE_COUNTER
                && completed < MAX_EVIDENCE_COUNTER
                && !self.counters.overflowed.load(Ordering::SeqCst),
        }
    }

    /// Keep this owned permit in the task that commits the persistent fence.
    /// Dropping its caller must not let provider work overtake that commit.
    pub(crate) async fn drain(&self) -> OwnedRwLockWriteGuard<()> {
        self.barrier.clone().write_owned().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::{poll_fn, Future};
    use std::task::Poll;

    #[test]
    fn window_closure_attempts_every_window_and_preserves_failures() {
        let mut attempted = Vec::new();
        let error =
            request_window_closure(&["x-login", "fb-scraper", "youtube-session"], |label| {
                attempted.push(label.to_owned());
                if label == "fb-scraper" {
                    Ok(())
                } else {
                    Err("destroy failed".into())
                }
            })
            .unwrap_err();
        assert_eq!(attempted, ["x-login", "fb-scraper", "youtube-session"]);
        assert!(error.contains("x-login: destroy failed"));
        assert!(error.contains("youtube-session: destroy failed"));
        assert!(request_window_closure(&["already-absent"], |_| Ok(())).is_ok());
    }

    #[tokio::test]
    async fn drain_waits_for_admitted_work_and_closes_admission_until_commit_finishes() {
        let gate = ProviderOperationGate::default();
        let first = gate.try_begin().unwrap().admit();
        let second = gate.try_begin().unwrap().admit();
        assert_eq!(gate.snapshot().active, Some(2));
        assert_eq!(gate.snapshot(), gate.clone().snapshot());
        let mut draining = Box::pin(gate.drain());
        assert!(poll_fn(|cx| Poll::Ready(draining.as_mut().poll(cx).is_pending())).await);
        assert!(gate.try_begin().is_err());
        drop(first);
        assert!(poll_fn(|cx| Poll::Ready(draining.as_mut().poll(cx).is_pending())).await);
        drop(second);
        let commit_permit = draining.await;
        assert_eq!(gate.snapshot().admitted, 2);
        assert_eq!(gate.snapshot().completed, 2);
        assert_eq!(gate.snapshot().active, Some(0));
        assert!(gate.snapshot().healthy);
        assert!(gate.try_begin().is_err());
        // Move ownership to the native commit task, then drop its caller handle.
        let (release, receive) = tokio::sync::oneshot::channel::<()>();
        let (finished, completion) = tokio::sync::oneshot::channel::<()>();
        let task = tokio::spawn(async move {
            let permit = commit_permit;
            receive.await.unwrap();
            drop(permit);
            finished.send(()).unwrap();
        });
        drop(task);
        assert!(gate.try_begin().is_err());
        release.send(()).unwrap();
        completion.await.unwrap();
        assert!(gate.try_begin().is_ok());
    }

    #[tokio::test]
    async fn evidence_tracks_owned_work_after_its_caller_disappears() {
        let gate = ProviderOperationGate::default();
        let fresh = gate.snapshot();
        assert!(fresh.healthy);
        assert_eq!(fresh.active, Some(0));
        assert_eq!(
            serde_json::to_value(&fresh).unwrap(),
            serde_json::json!({
                "schemaVersion": 1, "instanceId": fresh.instance_id,
                "admitted": 0, "completed": 0, "active": 0, "healthy": true,
            })
        );
        assert_ne!(
            fresh.instance_id,
            ProviderOperationGate::default().snapshot().instance_id
        );
        // Failed authority verification drops a reservation, not an admission.
        drop(gate.try_begin().unwrap());
        assert_eq!(fresh, gate.snapshot());
        let permit = gate.try_begin().unwrap().admit();
        let (release, receive) = tokio::sync::oneshot::channel::<()>();
        let (finished, completion) = tokio::sync::oneshot::channel::<()>();
        let task = tokio::spawn(async move {
            receive.await.unwrap();
            drop(permit);
            finished.send(()).unwrap();
        });
        drop(task);
        assert_eq!(gate.snapshot().active, Some(1));
        release.send(()).unwrap();
        completion.await.unwrap();
        let final_sample = gate.snapshot();
        assert_eq!(final_sample.admitted, 1);
        assert_eq!(final_sample.completed, 1);
        assert_eq!(final_sample.active, Some(0));
        assert!(final_sample.healthy);
    }

    #[test]
    fn saturated_counters_never_wrap_or_change_operation_admission() {
        let gate = ProviderOperationGate::default();
        gate.counters
            .admitted
            .store(MAX_EVIDENCE_COUNTER, Ordering::SeqCst);
        gate.counters
            .completed
            .store(MAX_EVIDENCE_COUNTER, Ordering::SeqCst);
        let permit = gate.try_begin().unwrap().admit();
        assert!(!gate.snapshot().healthy);
        drop(permit);
        let sample = gate.snapshot();
        assert_eq!(sample.admitted, MAX_EVIDENCE_COUNTER);
        assert_eq!(sample.completed, MAX_EVIDENCE_COUNTER);
        assert!(!sample.healthy);
        assert!(gate.try_begin().is_ok());
    }

    #[tokio::test]
    async fn cancelling_a_wait_before_commit_does_not_leave_an_in_memory_fence() {
        let gate = ProviderOperationGate::default();
        let active = gate.try_begin().unwrap();
        let mut draining = Box::pin(gate.drain());
        assert!(poll_fn(|cx| Poll::Ready(draining.as_mut().poll(cx).is_pending())).await);
        assert!(gate.try_begin().is_err());
        drop(draining);
        assert!(gate.try_begin().is_ok());
        drop(active);
    }
}
