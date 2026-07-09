// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // Privileged applier mode: used by the root LaunchDaemon (macOS) and the
    // SYSTEM scheduled task (Windows) to apply the hosts-file block section.
    // Runs headless and exits.
    if args.iter().any(|a| a == "--apply-hosts") {
        std::process::exit(yfblock_lib::blocking::hosts::apply_from_spool_cli());
    }

    yfblock_lib::run()
}
