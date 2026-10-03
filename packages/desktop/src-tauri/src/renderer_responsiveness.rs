//! Aggregate-only diagnostics received through the existing renderer heartbeat.

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RendererActiveSurface {
    Feed,
    FriendsGraph,
    Map,
    Settings,
    Dialog,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RendererResponsivenessPayload {
    probe_interval_ms: u64,
    delay_threshold_ms: u64,
    observation_ms: f64,
    foreground_observed_ms: f64,
    timer_samples: u64,
    frame_callback_samples: u64,
    delayed_timer_count: u64,
    delayed_frame_callback_count: u64,
    max_timer_lag_ms: Option<f64>,
    max_frame_callback_wait_ms: Option<f64>,
    long_tasks_supported: bool,
    long_task_count: Option<u64>,
    long_task_total_ms: Option<f64>,
    long_task_max_ms: Option<f64>,
}

pub(crate) fn health_fields(
    surface: Option<&RendererActiveSurface>,
    responsiveness: Option<&RendererResponsivenessPayload>,
) -> serde_json::Map<String, serde_json::Value> {
    let mut fields = serde_json::Map::new();
    fields.insert("activeSurface".into(), serde_json::json!(surface));
    fields.insert("responsiveness".into(), serde_json::json!(responsiveness));
    fields
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_long_tasks_and_unobserved_frame_callback_remain_null_in_health() {
        let payload: RendererResponsivenessPayload = serde_json::from_value(serde_json::json!({
            "probeIntervalMs": 250, "delayThresholdMs": 100,
            "observationMs": 500, "foregroundObservedMs": 500,
            "timerSamples": 1, "frameCallbackSamples": 0,
            "delayedTimerCount": 1, "delayedFrameCallbackCount": 0,
            "maxTimerLagMs": 250, "maxFrameCallbackWaitMs": null,
            "longTasksSupported": false, "longTaskCount": null,
            "longTaskTotalMs": null, "longTaskMaxMs": null,
            "untrustedContent": "never persisted"
        }))
        .unwrap();
        let fields = health_fields(Some(&RendererActiveSurface::Feed), Some(&payload));
        assert_eq!(fields["activeSurface"], "feed");
        assert_eq!(fields["responsiveness"]["maxTimerLagMs"], 250.0);
        assert_eq!(fields["responsiveness"]["longTasksSupported"], false);
        assert!(fields["responsiveness"]["longTaskCount"].is_null());
        assert!(fields["responsiveness"]["maxFrameCallbackWaitMs"].is_null());
        assert!(fields["responsiveness"].get("untrustedContent").is_none());
    }

    #[test]
    fn legacy_heartbeat_diagnostics_remain_unavailable() {
        let fields = health_fields(None, None);
        assert!(fields["activeSurface"].is_null());
        assert!(fields["responsiveness"].is_null());
    }
}
