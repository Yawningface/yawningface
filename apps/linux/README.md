# apps/linux — planned desktop target

Status: **design placeholder only; no Linux build is shipped yet.**

Linux should extend [`apps/desktop`](../desktop), not fork its React/Tauri UI,
sync engine, or contract evaluator. This directory is reserved for Linux-only
packaging, privileged-helper integration, smoke tests, and platform notes once
implementation begins.

## Intended shape

- **Shared client:** compile the existing Tauri desktop app for Linux and keep
  schedule/session semantics identical to macOS and Windows.
- **Website enforcement:** a root-owned helper, preferably managed by systemd,
  consumes the same user-writable domain spool and owns the managed
  `/etc/hosts` section. Tough Mode must use the same monotonic, atomic lock
  protocol as macOS before it can be advertised.
- **Application enforcement:** reuse the Rust process watcher first. Evaluate
  cgroups/systemd scopes only if process killing proves too easy to bypass.
- **Startup and packaging:** XDG autostart plus Tauri-produced AppImage for the
  first developer preview; add `.deb`/`.rpm` only after install/uninstall of
  the privileged helper is reliable.
- **Contract:** consume the canonical schema and remain fully offline-capable;
  Linux must not introduce a platform-specific config dialect.

## Before calling it supported

- [ ] Build and run on the current Ubuntu LTS on x86_64.
- [ ] Pull/evaluate cached config, run local sessions, and emit bridge state.
- [ ] Install, upgrade, verify, and completely uninstall the root helper.
- [ ] Preserve unrelated `/etc/hosts` content and recover from interrupted
      writes without silently weakening an active lock.
- [ ] Verify Chrome/Chromium/Firefox behavior, including the documented DoH
      limitation of hosts-level enforcement.
- [ ] Add Linux CI, packaging artifacts, and an end-to-end smoke test before
      changing any status page from "planned."

Do not add a separate package manifest here until Linux-specific executable
code exists; an empty workspace package would imply support that is not real.
