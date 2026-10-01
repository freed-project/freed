//! Native operation lifetime barrier for cooperative authority transfer.
//! This tracks admitted native work, not persistent WebViews or renderer work.

use std::sync::Arc;
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

#[derive(Clone, Default)]
pub(crate) struct ProviderOperationGate(Arc<RwLock<()>>);

impl ProviderOperationGate {
    pub(crate) fn try_begin(&self) -> Result<OwnedRwLockReadGuard<()>, String> {
        self.0.clone().try_read_owned().map_err(|_| {
            "Provider activity is paused while the Library prepares an authority transfer.".into()
        })
    }

    /// Keep this owned permit in the task that commits the persistent fence.
    /// Dropping its caller must not let provider work overtake that commit.
    pub(crate) async fn drain(&self) -> OwnedRwLockWriteGuard<()> {
        self.0.clone().write_owned().await
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
        let first = gate.try_begin().unwrap();
        let second = gate.try_begin().unwrap();
        let mut draining = Box::pin(gate.drain());
        assert!(poll_fn(|cx| Poll::Ready(draining.as_mut().poll(cx).is_pending())).await);
        assert!(gate.try_begin().is_err());
        drop(first);
        assert!(poll_fn(|cx| Poll::Ready(draining.as_mut().poll(cx).is_pending())).await);
        drop(second);
        let commit_permit = draining.await;
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
