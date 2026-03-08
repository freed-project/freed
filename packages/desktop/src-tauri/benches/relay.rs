/**
 * Criterion benchmarks for Freed Desktop Rust hot paths.
 *
 * Benchmarks cover the three operations that run on every doc mutation:
 *   1. write_snapshot  — timestamped binary write to the snapshots dir
 *   2. prune_snapshots — GFS retention policy scan + delete
 *   3. broadcast_doc   — JSON serialisation + relay channel send
 *
 * Run with:
 *   cargo bench --bench relay
 *
 * Results are written to target/criterion/. Install criterion-table for
 * GitHub-ready Markdown output:
 *   cargo install criterion-table
 *   cargo bench --bench relay -- --output-format bencher 2>/dev/null | criterion-table > bench.md
 */

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use std::fs;
use std::time::SystemTime;
use tempfile::TempDir;
use tokio::runtime::Runtime;
use tokio::sync::broadcast;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Generate a synthetic Automerge binary blob of approximately `size_bytes`.
fn make_binary(size_bytes: usize) -> Vec<u8> {
    // Automerge binaries start with a magic header then compressed data.
    // For benchmarking we care about write latency, not CRDT correctness,
    // so a realistic-size random payload is sufficient.
    let mut buf = vec![0u8; size_bytes];
    // Sprinkle non-zero bytes so the OS can't zero-page optimise the write.
    for (i, b) in buf.iter_mut().enumerate() {
        *b = (i.wrapping_mul(17).wrapping_add(31) & 0xFF) as u8;
    }
    buf
}

/// Simulate the write_snapshot path: write timestamped file + sync to OS.
fn write_snapshot_bench(dir: &std::path::Path, binary: &[u8]) {
    let ts = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let path = dir.join(format!("freed-{ts}.automerge"));
    fs::write(&path, binary).expect("write_snapshot bench write failed");
}

/// Simulate prune_snapshots: list dir, parse timestamps, keep GFS buckets.
fn prune_snapshots_bench(dir: &std::path::Path, max_minutely: usize) {
    let entries = fs::read_dir(dir)
        .expect("read_dir failed")
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            // Extract timestamp from "freed-{ms}.automerge"
            let stem = name.strip_prefix("freed-")?.strip_suffix(".automerge")?;
            stem.parse::<u128>().ok().map(|ts| (ts, e.path()))
        })
        .collect::<Vec<_>>();

    // Keep only the most recent `max_minutely` entries; delete the rest.
    let mut sorted = entries;
    sorted.sort_by(|a, b| b.0.cmp(&a.0)); // newest first

    for (_, path) in sorted.iter().skip(max_minutely) {
        let _ = fs::remove_file(path);
    }
}

/// Simulate broadcast_doc: Array.from(Uint8Array) equivalent in Rust = clone
/// then send over broadcast channel.
fn broadcast_doc_bench(tx: &broadcast::Sender<Vec<u8>>, binary: &[u8]) {
    let data = binary.to_vec();
    let _ = tx.send(data);
}

// ---------------------------------------------------------------------------
// Benchmark groups
// ---------------------------------------------------------------------------

fn bench_write_snapshot(c: &mut Criterion) {
    let mut group = c.benchmark_group("write_snapshot");

    for size_kb in [100usize, 500, 1_000, 5_000] {
        let binary = make_binary(size_kb * 1024);
        let dir = TempDir::new().expect("tempdir");
        group.throughput(Throughput::Bytes(binary.len() as u64));
        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{size_kb}KB")),
            &binary,
            |b, bin| {
                b.iter(|| write_snapshot_bench(dir.path(), bin));
            },
        );
    }
    group.finish();
}

fn bench_prune_snapshots(c: &mut Criterion) {
    let mut group = c.benchmark_group("prune_snapshots");

    for snapshot_count in [10usize, 50, 200] {
        let dir = TempDir::new().expect("tempdir");
        // Pre-populate the directory with the given number of snapshots.
        let binary = make_binary(64 * 1024); // 64KB each
        for i in 0..snapshot_count {
            let path = dir.path().join(format!("freed-{i}000.automerge"));
            fs::write(&path, &binary).expect("pre-populate");
        }

        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{snapshot_count}_snapshots")),
            &snapshot_count,
            |b, &count| {
                b.iter(|| {
                    prune_snapshots_bench(dir.path(), 60);
                    // Re-populate so each iteration starts from the same state.
                    for i in 0..count {
                        let path = dir.path().join(format!("freed-{i}000.automerge"));
                        let _ = fs::write(&path, &binary);
                    }
                });
            },
        );
    }
    group.finish();
}

fn bench_broadcast_doc(c: &mut Criterion) {
    let rt = Runtime::new().expect("tokio runtime");
    let mut group = c.benchmark_group("broadcast_doc");

    for size_kb in [100usize, 500, 1_000, 5_000] {
        let binary = make_binary(size_kb * 1024);
        let (tx, _rx) = broadcast::channel::<Vec<u8>>(16);

        // Keep a receiver alive so sends don't short-circuit
        let _rx2 = tx.subscribe();

        group.throughput(Throughput::Bytes(binary.len() as u64));
        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{size_kb}KB")),
            &binary,
            |b, bin| {
                let _guard = rt.enter();
                b.iter(|| broadcast_doc_bench(&tx, bin));
            },
        );
    }
    group.finish();
}

fn bench_json_serialise(c: &mut Criterion) {
    // Simulate the Array.from(Uint8Array) → serde_json::to_vec() pattern used
    // in broadcast_doc before the worker migration (where it still runs for the
    // Tauri invoke call from the worker).
    let mut group = c.benchmark_group("json_serialise");

    for size_kb in [100usize, 500, 1_000] {
        let binary = make_binary(size_kb * 1024);
        group.throughput(Throughput::Bytes(binary.len() as u64));
        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{size_kb}KB")),
            &binary,
            |b, bin| {
                b.iter(|| {
                    // This is what happens when the JS main thread calls
                    // Array.from(Uint8Array) and then Tauri serialises it.
                    let as_array: Vec<u8> = bin.to_vec();
                    let json = serde_json::to_vec(&as_array).expect("json");
                    criterion::black_box(json);
                });
            },
        );
    }
    group.finish();
}

criterion_group!(
    benches,
    bench_write_snapshot,
    bench_prune_snapshots,
    bench_broadcast_doc,
    bench_json_serialise,
);
criterion_main!(benches);
