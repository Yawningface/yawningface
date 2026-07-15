// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // Chrome launches the installed desktop executable with the caller's
    // extension origin when it needs to record a browser event. Handle that
    // stdio protocol before starting Tauri or the single-instance plugin.
    if let Some(code) = yfblock_lib::native_messaging::run_if_requested(&args) {
        std::process::exit(code);
    }

    // Privileged applier mode: used by the root LaunchDaemon (macOS) and the
    // SYSTEM scheduled task (Windows) to apply the hosts-file block section.
    // Runs headless and exits.
    if args.iter().any(|a| a == "--apply-hosts") {
        std::process::exit(yfblock_lib::blocking::hosts::apply_from_spool_cli());
    }

    yfblock_lib::run()
}
