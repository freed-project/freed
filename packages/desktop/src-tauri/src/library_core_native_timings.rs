//! Bounded, content-free native stage timing. No authority verdicts are cached.

use std::sync::{Mutex, OnceLock};
use std::time::Instant;

const WINDOW_US: u64 = 60_000_000;
const MAX_EVENTS: usize = 12;
const LEGACY_STAGE_COUNT: usize = 7;
const STAGE_COUNT: usize = 15;
const SCOPE_COUNT: usize = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Scope {
    InstallationWitness,
    CloudIdentity,
    CloudPreflightIdentity,
    CheckpointPrepare,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Stage {
    InstallationWitness,
    SelectedOpen,
    WriterIdentity,
    ExportCount,
    ItemCount,
    FrontierAndValidation,
    ActorIdentity,
    CheckpointAdmission,
    ExportReaper,
    SnapshotBegin,
    TemporaryMaterialization,
    OrderIndex,
    DescriptorClone,
    SessionLock,
    SessionReplacement,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Phase {
    Started,
    StageStarted,
    Completed,
    Failed,
}

// The record deliberately cannot carry an identifier, content or error text.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Event {
    pub scope: Scope,
    pub phase: Phase,
    pub stage: Option<Stage>,
    pub total_us: u64,
    pub entered_stages: u16,
    // Fixed order is the Stage declaration above. Values are accumulated time.
    pub durations_us: [u64; STAGE_COUNT],
}

// Preserve the legacy decimal record layout. Checkpoint durations use a fixed
// hexadecimal array to keep even saturated u64 values within 512 log bytes.
impl std::fmt::Debug for Event {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut record = f.debug_struct("Event");
        record
            .field("scope", &self.scope)
            .field("phase", &self.phase)
            .field("stage", &self.stage)
            .field("total_us", &self.total_us);
        if self.scope == Scope::CheckpointPrepare {
            record
                .field("entered_stages", &self.entered_stages)
                .field("durations_us_hex", &HexDurations(&self.durations_us));
        } else {
            record.field("durations_us", &&self.durations_us[..LEGACY_STAGE_COUNT]);
        }
        record.finish()
    }
}

struct HexDurations<'a>(&'a [u64; STAGE_COUNT]);
impl std::fmt::Debug for HexDurations<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("[")?;
        for (index, duration) in self.0.iter().enumerate() {
            if index > 0 {
                f.write_str(",")?;
            }
            write!(f, "{duration:x}")?;
        }
        f.write_str("]")
    }
}

pub(crate) struct Limiter {
    last_started: [Option<u64>; SCOPE_COUNT],
    in_flight: [bool; SCOPE_COUNT],
    emitted_at: [Option<u64>; MAX_EVENTS],
}

impl Limiter {
    const fn new() -> Self {
        Self {
            last_started: [None; SCOPE_COUNT],
            in_flight: [false; SCOPE_COUNT],
            emitted_at: [None; MAX_EVENTS],
        }
    }

    fn start(&mut self, scope: Scope, now: u64) -> bool {
        if self.in_flight[scope as usize] {
            return false;
        }
        let last = &mut self.last_started[scope as usize];
        if last.is_some_and(|previous| now.saturating_sub(previous) < WINDOW_US) {
            return false;
        }
        *last = Some(now);
        self.in_flight[scope as usize] = true;
        true
    }

    fn event(&mut self, now: u64) -> bool {
        for timestamp in &mut self.emitted_at {
            if timestamp.is_some_and(|previous| now.saturating_sub(previous) >= WINDOW_US) {
                *timestamp = None;
            }
        }
        let Some(slot) = self.emitted_at.iter_mut().find(|slot| slot.is_none()) else {
            return false;
        };
        *slot = Some(now);
        true
    }
}

#[cfg(test)]
pub(crate) fn test_limiter() -> Mutex<Limiter> {
    Mutex::new(Limiter::new())
}

pub(crate) fn global_limiter() -> &'static Mutex<Limiter> {
    static LIMITER: Mutex<Limiter> = Mutex::new(Limiter::new());
    &LIMITER
}

pub(crate) fn monotonic_us() -> u64 {
    static EPOCH: OnceLock<Instant> = OnceLock::new();
    EPOCH
        .get_or_init(Instant::now)
        .elapsed()
        .as_micros()
        .min(u64::MAX as u128) as u64
}

pub(crate) struct Trace<'a, Clock, Sink> {
    limiter: &'a Mutex<Limiter>,
    clock: Clock,
    sink: Sink,
    active: bool,
    started_at: u64,
    stage_started_at: u64,
    event: Event,
}

impl<Clock, Sink> Drop for Trace<'_, Clock, Sink> {
    fn drop(&mut self) {
        if self.active {
            if let Ok(mut limiter) = self.limiter.lock() {
                limiter.in_flight[self.event.scope as usize] = false;
            }
        }
    }
}

impl<Clock: FnMut() -> u64, Sink: FnMut(Event)> Trace<'_, Clock, Sink> {
    fn emit(&mut self, now: u64, phase: Phase) {
        self.event.phase = phase;
        self.event.total_us = now.saturating_sub(self.started_at);
        let allowed = self
            .limiter
            .lock()
            .ok()
            .is_some_and(|mut limiter| limiter.event(now));
        // Logging never runs under the limiter mutex.
        if allowed {
            (self.sink)(self.event);
        }
    }

    fn finish_stage(&mut self, now: u64) {
        if let Some(stage) = self.event.stage {
            let duration = &mut self.event.durations_us[stage as usize];
            *duration = duration.saturating_add(now.saturating_sub(self.stage_started_at));
        }
    }

    pub(crate) fn stage(&mut self, stage: Stage) {
        if !self.active {
            return;
        }
        let now = (self.clock)();
        self.finish_stage(now);
        self.event.stage = Some(stage);
        self.event.entered_stages |= 1 << (stage as usize);
        self.stage_started_at = now;
        if self.event.scope != Scope::CheckpointPrepare {
            self.emit(now, Phase::StageStarted);
        }
    }

    fn finish(&mut self, success: bool) {
        if !self.active {
            return;
        }
        let now = (self.clock)();
        self.finish_stage(now);
        self.emit(
            now,
            if success {
                Phase::Completed
            } else {
                Phase::Failed
            },
        );
    }
}

/// Run the same operation and return its original Result, even when disabled,
/// sampled out or diagnostic locks are poisoned. Only fixed timing data exits.
pub(crate) fn with_trace<T, Error, Clock, Sink, Run>(
    scope: Scope,
    enabled: bool,
    limiter: &Mutex<Limiter>,
    mut clock: Clock,
    sink: Sink,
    run: Run,
) -> Result<T, Error>
where
    Clock: FnMut() -> u64,
    Sink: FnMut(Event),
    Run: FnOnce(&mut Trace<'_, Clock, Sink>) -> Result<T, Error>,
{
    let started_at = if enabled { clock() } else { 0 };
    let active = enabled
        && limiter
            .lock()
            .ok()
            .is_some_and(|mut limiter| limiter.start(scope, started_at));
    let mut trace = Trace {
        limiter,
        clock,
        sink,
        active,
        started_at,
        stage_started_at: started_at,
        event: Event {
            scope,
            phase: Phase::Started,
            stage: None,
            total_us: 0,
            entered_stages: 0,
            durations_us: [0; STAGE_COUNT],
        },
    };
    if active {
        trace.emit(started_at, Phase::Started);
    }
    let result = run(&mut trace);
    trace.finish(result.is_ok());
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    #[test]
    fn successful_stage_durations_include_logging_overhead_and_preserve_result() {
        let limiter = Mutex::new(Limiter::new());
        let now = Cell::new(0);
        let events = RefCell::new(Vec::new());
        let result: Result<u32, &str> = with_trace(
            Scope::CloudIdentity,
            true,
            &limiter,
            || now.get(),
            |event| {
                events.borrow_mut().push(event);
                now.set(now.get() + 5);
            },
            |trace| {
                trace.stage(Stage::SelectedOpen);
                now.set(now.get() + 20);
                trace.stage(Stage::ExportCount);
                now.set(now.get() + 50);
                Ok(7)
            },
        );
        assert_eq!(result, Ok(7));
        let records = events.borrow();
        assert_eq!(records.len(), 4);
        let end = records.last().unwrap();
        assert_eq!(end.phase, Phase::Completed);
        assert_eq!(end.total_us, 85);
        assert_eq!(end.durations_us[Stage::SelectedOpen as usize], 25);
        assert_eq!(end.durations_us[Stage::ExportCount as usize], 55);
    }

    #[test]
    fn every_failure_stage_preserves_error_without_logging_its_text() {
        for stage in [
            Stage::InstallationWitness,
            Stage::SelectedOpen,
            Stage::WriterIdentity,
            Stage::ExportCount,
            Stage::ItemCount,
            Stage::FrontierAndValidation,
            Stage::ActorIdentity,
        ] {
            let limiter = Mutex::new(Limiter::new());
            let now = Cell::new(0);
            let events = RefCell::new(Vec::new());
            let result: Result<(), &str> = with_trace(
                Scope::CloudIdentity,
                true,
                &limiter,
                || now.get(),
                |event| events.borrow_mut().push(event),
                |trace| {
                    trace.stage(stage);
                    now.set(45);
                    Err("private error credential content")
                },
            );
            assert_eq!(result, Err("private error credential content"));
            let records = events.borrow();
            let end = records.last().unwrap();
            assert_eq!(end.phase, Phase::Failed);
            assert_eq!(end.stage, Some(stage));
            assert_eq!(end.durations_us[stage as usize], 45);
            assert!(!format!("{records:?}").contains("private"));
        }
    }

    #[test]
    fn disabled_logging_runs_operation_without_clock_sink_or_budget() {
        let limiter = Mutex::new(Limiter::new());
        let called = Cell::new(false);
        let result: Result<u32, &str> = with_trace(
            Scope::CloudIdentity,
            false,
            &limiter,
            || panic!("clock called"),
            |_| panic!("sink called"),
            |trace| {
                called.set(true);
                trace.stage(Stage::SelectedOpen);
                Ok(5)
            },
        );
        assert!(called.get());
        assert_eq!(result, Ok(5));
        assert_eq!(limiter.lock().unwrap().last_started, [None; SCOPE_COUNT]);
    }

    #[test]
    fn witness_sampling_does_not_suppress_identity_but_same_scope_is_sampled_out() {
        let limiter = Mutex::new(Limiter::new());
        let events = RefCell::new(Vec::new());
        let calls = Cell::new(0);
        for scope in [
            Scope::InstallationWitness,
            Scope::CloudIdentity,
            Scope::CloudPreflightIdentity,
            Scope::CloudIdentity,
            Scope::CloudPreflightIdentity,
        ] {
            let result: Result<(), ()> = with_trace(
                scope,
                true,
                &limiter,
                || 0,
                |event| events.borrow_mut().push(event),
                |trace| {
                    calls.set(calls.get() + 1);
                    trace.stage(Stage::SelectedOpen);
                    Ok(())
                },
            );
            assert!(result.is_ok());
        }
        assert_eq!(calls.get(), 5);
        assert_eq!(events.borrow().len(), 9);
    }

    #[test]
    fn rolling_budget_bounds_delayed_completion_and_boundary_bursts() {
        let mut limiter = Limiter::new();
        for _ in 0..MAX_EVENTS {
            assert!(limiter.event(59_999_999));
        }
        assert!(!limiter.event(60_000_000));
        assert!(!limiter.event(119_999_998));
        for _ in 0..MAX_EVENTS {
            assert!(limiter.event(119_999_999));
        }
        assert!(!limiter.event(119_999_999));
    }

    #[test]
    fn a_stage_event_flood_is_bounded_without_changing_the_result() {
        let limiter = Mutex::new(Limiter::new());
        let events = RefCell::new(Vec::new());
        let result: Result<u32, ()> = with_trace(
            Scope::CloudIdentity,
            true,
            &limiter,
            || 0,
            |event| events.borrow_mut().push(event),
            |trace| {
                for _ in 0..10_000 {
                    trace.stage(Stage::ExportCount);
                }
                Ok(9)
            },
        );
        assert_eq!(result, Ok(9));
        assert_eq!(events.borrow().len(), MAX_EVENTS);
    }

    #[test]
    fn maximum_scalar_values_keep_each_event_below_512_bytes() {
        for scope in [
            Scope::InstallationWitness,
            Scope::CloudIdentity,
            Scope::CloudPreflightIdentity,
            Scope::CheckpointPrepare,
        ] {
            for stage in [
                Stage::FrontierAndValidation,
                Stage::TemporaryMaterialization,
                Stage::SessionReplacement,
            ] {
                let event = Event {
                    scope,
                    phase: Phase::StageStarted,
                    stage: Some(stage),
                    total_us: u64::MAX,
                    entered_stages: u16::MAX,
                    durations_us: [u64::MAX; STAGE_COUNT],
                };
                assert!(format!("[library-native-timing] {event:?}").len() < 512);
            }
        }
    }

    #[test]
    fn checkpoint_summary_separates_zero_duration_from_unentered_and_preserves_legacy_layout() {
        assert_eq!(Stage::ActorIdentity as usize, 6);
        assert_eq!(Stage::CheckpointAdmission as usize, 7);
        let limiter = Mutex::new(Limiter::new());
        let now = Cell::new(0);
        let events = RefCell::new(Vec::new());
        let result: Result<u32, &str> = with_trace(
            Scope::CheckpointPrepare,
            true,
            &limiter,
            || now.get(),
            |e| events.borrow_mut().push(e),
            |trace| {
                trace.stage(Stage::SelectedOpen); // Entered, measured zero.
                trace.stage(Stage::SessionLock);
                now.set(10);
                trace.stage(Stage::SessionReplacement);
                now.set(30);
                Ok(9)
            },
        );
        assert_eq!(result, Ok(9));
        let events = events.borrow();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].phase, Phase::Started);
        let end = events[1];
        assert_eq!(end.phase, Phase::Completed);
        assert_eq!(end.durations_us[Stage::SessionLock as usize], 10);
        assert_eq!(end.durations_us[Stage::SessionReplacement as usize], 20);
        assert_eq!(
            end.entered_stages,
            (1 << Stage::SelectedOpen as usize)
                | (1 << Stage::SessionLock as usize)
                | (1 << Stage::SessionReplacement as usize)
        );
        assert_eq!(end.durations_us[Stage::SelectedOpen as usize], 0);
        assert_eq!(end.durations_us[Stage::OrderIndex as usize], 0);
        let legacy = Event {
            scope: Scope::CloudIdentity,
            phase: Phase::Completed,
            stage: None,
            total_us: 0,
            entered_stages: 0,
            durations_us: [0; STAGE_COUNT],
        };
        assert_eq!(format!("{legacy:?}"), "Event { scope: CloudIdentity, phase: Completed, stage: None, total_us: 0, durations_us: [0, 0, 0, 0, 0, 0, 0] }");
    }

    #[test]
    fn checkpoint_failure_sampling_and_shared_event_cap_preserve_work() {
        let limiter = Mutex::new(Limiter::new());
        let events = RefCell::new(Vec::new());
        for i in 0..2 {
            let result: Result<(), &str> = with_trace(
                Scope::CheckpointPrepare,
                true,
                &limiter,
                || 0,
                |e| events.borrow_mut().push(e),
                |trace| {
                    trace.stage(Stage::OrderIndex);
                    Err("private error")
                },
            );
            assert_eq!(result, Err("private error"));
            assert_eq!(
                events.borrow().len(),
                2,
                "same scope must be suppressed on run {i}"
            );
        }
        assert_eq!(events.borrow()[1].phase, Phase::Failed);
        assert_eq!(
            events.borrow()[1].entered_stages,
            1 << Stage::OrderIndex as usize
        );
        assert!(!format!("{:?}", events.borrow()).contains("private"));
        let mut locked = limiter.lock().unwrap();
        for _ in 2..MAX_EVENTS {
            assert!(locked.event(0));
        }
        drop(locked);
        let result: Result<u32, ()> = with_trace(
            Scope::CloudIdentity,
            true,
            &limiter,
            || 0,
            |_| panic!("global cap exceeded"),
            |_| Ok(3),
        );
        assert_eq!(result, Ok(3));
        let calls = Cell::new(0);
        let _: Result<(), ()> = with_trace(
            Scope::CheckpointPrepare,
            true,
            &limiter,
            || WINDOW_US,
            |_| calls.set(calls.get() + 1),
            |trace| {
                trace.stage(Stage::OrderIndex);
                Ok(())
            },
        );
        assert_eq!(calls.get(), 2);
    }

    #[test]
    fn a_long_trace_never_interleaves_same_scope_sampled_events() {
        let limiter = Mutex::new(Limiter::new());
        let now = Cell::new(0);
        let events = RefCell::new(Vec::new());
        let result: Result<(), ()> = with_trace(
            Scope::CloudIdentity,
            true,
            &limiter,
            || now.get(),
            |event| events.borrow_mut().push(event),
            |trace| {
                trace.stage(Stage::SelectedOpen);
                now.set(WINDOW_US + 1);
                let nested: Result<u32, ()> = with_trace(
                    Scope::CloudIdentity,
                    true,
                    &limiter,
                    || now.get(),
                    |_| panic!("interleaved sample"),
                    |trace| {
                        trace.stage(Stage::ExportCount);
                        Ok(3)
                    },
                );
                assert_eq!(nested, Ok(3));
                Ok(())
            },
        );
        assert!(result.is_ok());
        assert_eq!(events.borrow().len(), 3);
        let next: Result<(), ()> = with_trace(
            Scope::CloudIdentity,
            true,
            &limiter,
            || now.get(),
            |event| events.borrow_mut().push(event),
            |_| Ok(()),
        );
        assert!(next.is_ok());
        assert_eq!(events.borrow().len(), 5);
    }

    #[test]
    fn an_operation_panic_releases_only_its_diagnostic_sampling_slot() {
        let limiter = Mutex::new(Limiter::new());
        let panicked = std::panic::catch_unwind(|| {
            let _: Result<(), ()> = with_trace(
                Scope::CloudIdentity,
                true,
                &limiter,
                || 0,
                |_| {},
                |_| panic!("original operation panic"),
            );
        });
        assert!(panicked.is_err());
        assert_eq!(limiter.lock().unwrap().in_flight, [false; SCOPE_COUNT]);
        let emitted = Cell::new(0);
        let next: Result<(), ()> = with_trace(
            Scope::CloudIdentity,
            true,
            &limiter,
            || WINDOW_US,
            |_| emitted.set(emitted.get() + 1),
            |_| Ok(()),
        );
        assert!(next.is_ok());
        assert_eq!(emitted.get(), 2);
    }

    #[test]
    fn poisoned_diagnostic_lock_never_changes_operation_result() {
        let limiter = Mutex::new(Limiter::new());
        let _ = std::panic::catch_unwind(|| {
            let _guard = limiter.lock().unwrap();
            panic!("test poison");
        });
        let result: Result<(), &str> = with_trace(
            Scope::CloudIdentity,
            true,
            &limiter,
            || 0,
            |_| panic!("sink called"),
            |trace| {
                trace.stage(Stage::ActorIdentity);
                Err("same error")
            },
        );
        assert_eq!(result, Err("same error"));
    }

    #[test]
    fn concurrent_sampling_admits_one_trace_per_scope() {
        let limiter = Mutex::new(Limiter::new());
        let barrier = std::sync::Barrier::new(8);
        let emitted = std::sync::atomic::AtomicUsize::new(0);
        std::thread::scope(|threads| {
            for _ in 0..8 {
                threads.spawn(|| {
                    barrier.wait();
                    let _: Result<(), ()> = with_trace(
                        Scope::CloudIdentity,
                        true,
                        &limiter,
                        || 0,
                        |_| {
                            emitted.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        },
                        |trace| {
                            trace.stage(Stage::SelectedOpen);
                            Ok(())
                        },
                    );
                });
            }
        });
        assert_eq!(emitted.load(std::sync::atomic::Ordering::Relaxed), 3);
    }
}
