//! Aggregate-only diagnostics received through the existing renderer heartbeat.

/// Frontend provenance is diagnostic, not authority or artifact verification.
#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RendererRuntimeIdentity {
    app_version: Option<String>,
    build_commit_sha: Option<String>,
    build_kind: Option<String>,
    channel: Option<String>,
    app_session_id: Option<String>,
}

impl RendererRuntimeIdentity {
    pub(crate) fn health_fields(&self) -> serde_json::Map<String, serde_json::Value> {
        let mut fields = serde_json::Map::new();
        fields.insert("appVersion".into(), serde_json::json!(self.app_version));
        fields.insert(
            "buildCommitSha".into(),
            serde_json::json!(self.build_commit_sha),
        );
        fields.insert("buildKind".into(), serde_json::json!(self.build_kind));
        fields.insert("channel".into(), serde_json::json!(self.channel));
        fields.insert(
            "appSessionId".into(),
            serde_json::json!(self.app_session_id),
        );
        fields
    }
}

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
    fn startup_identity_survives_typed_health_serialization_without_content() {
        #[derive(serde::Deserialize)]
        struct Heartbeat {
            #[serde(flatten)]
            identity: RendererRuntimeIdentity,
        }
        let heartbeat: Heartbeat = serde_json::from_value(serde_json::json!({
            "appVersion": "26.10.300", "buildCommitSha": "7d354d0ff6dd2dce134941ad624b52df51222a4f",
            "buildKind": "release", "channel": "dev", "appSessionId": "synthetic-session",
            "appPhase": "legal", "visibility": "hidden", "untrustedContent": "discard"
        }))
        .unwrap();
        let fields = heartbeat.identity.health_fields();
        assert_eq!(fields.len(), 5);
        assert_eq!(
            fields["buildCommitSha"],
            "7d354d0ff6dd2dce134941ad624b52df51222a4f"
        );
        assert_eq!(fields["appSessionId"], "synthetic-session");
        assert!(!fields.contains_key("untrustedContent"));
        let legacy: Heartbeat =
            serde_json::from_value(serde_json::json!({"appPhase":"legal"})).unwrap();
        assert!(legacy
            .identity
            .health_fields()
            .values()
            .all(serde_json::Value::is_null));
    }

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
