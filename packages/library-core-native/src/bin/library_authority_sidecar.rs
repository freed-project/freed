#[cfg(unix)]
fn main() {
    if freed_library_core::run_library_authority_sidecar().is_err() {
        std::process::exit(70);
    }
}

#[cfg(not(unix))]
fn main() {
    std::process::exit(70);
}
