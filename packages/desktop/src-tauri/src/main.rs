// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod library_core_process_lease;

fn main() {
    let data_root = library_core_process_lease::freed_desktop_library_core_data_root()
        .unwrap_or_else(|error| refuse_startup(&error));
    let library_core_lease =
        library_core_process_lease::LibraryCoreProcessLease::acquire(&data_root)
            .unwrap_or_else(|error| refuse_startup(&error));
    debug_assert!(library_core_lease.owns_lock());
    freed_desktop_lib::run();
    drop(library_core_lease);
}

fn refuse_startup(error: &dyn std::fmt::Display) -> ! {
    eprintln!("[library-core] process startup refused: {error}");
    std::process::exit(1);
}
