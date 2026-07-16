# The tough-block persona

**The user who says "I don't trust my future self — take the keys away": they don't want friction or reminders, they want a block that is physically impossible to undo until the timer runs out.**

This is the persona [Cold Turkey](https://getcoldturkey.com) built its whole business on ("makes it almost impossible to stop the block once you lock it. No, you can't just uninstall it"). Our angle: the same lock, but open source — you can audit exactly what the lock does instead of trusting a black box with admin rights.

## How Tough Mode works on macOS

The principle (borrowed from the SelfControl school of blockers): **the app you can control is not the thing enforcing the block.**

1. **One-time setup** installs a root-owned applier script plus a LaunchDaemon (`org.yawningface.block.hostsd`). One admin prompt, silent forever after.
2. The app can only **request** a lock: it writes an end time + domain list to a user-writable request file.
3. The root applier merges requests **monotonically** into a root-owned lock file (`/Library/Application Support/YawningFaceBlock/lock.txt`): the end time can only move later (capped at 7 days), domains can only be added. Weakening requests are ignored.
4. While the lock is active, its domains are written into `/etc/hosts` **regardless of what the app or spool says**. There is deliberately no code path — in the app or in the applier — that ends a lock early.
5. **Self-healing:** launchd watches `/etc/hosts`; hand-editing it triggers an immediate re-apply. A 60-second interval run catches everything else and expires the lock exactly when the end time passes.
6. Quitting the app, deleting the app, or rebooting changes nothing: the LaunchDaemon and the lock file live in `/Library`, outside the app.

## What it does not (yet) defend against

Honesty is part of the positioning. A determined admin can still: boot into recovery mode, remove the LaunchDaemon with `sudo`, use DNS-over-HTTPS or another device. The bar we aim for is the SelfControl bar: friction that outlasts an impulse (minutes), not cryptographic impossibility.

Roadmap hardening, in order: daemon refuses self-removal while locked, packet-filter (PF) second layer to close the DoH hole, cloud "lock ledger" so weakening edits are rejected server-side across all devices, server-signed emergency-unlock tokens (support-mediated escape hatch).

## Related

- Open product questions: [docs/product-questions.md](../docs/product-questions.md)
- Desktop implementation: `apps/desktop/src-tauri/src/blocking/` (`lock.rs`, `platform.rs`)
