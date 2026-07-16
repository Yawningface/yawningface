# yawningface - Desktop

Cross-device distraction blocker for **macOS** and **Windows**. Open-source
alternative to Freedom, Cold Turkey and SelfControl, built with Tauri 2.

Part of the YawningFace system: one blocking schedule, synced to every device
you own. The cloud half lives in
[`block_cloud`](https://github.com/Yawningface/block_cloud); the iPhone app in
[`block_iphone`](https://github.com/Yawningface/block_iphone); the Chrome
extension in
[`block_chromium`](https://github.com/Yawningface/block_chromium).

## What it does

- Lives in the **menu bar** (macOS) / **system tray** (Windows). Closing the
  window keeps it running; it starts at login.
- Signs in with your **YawningFace account** (Auth0 device flow - a short code
  you confirm in the browser).
- Every 30 s it pulls your **blocking schedule** from the server, evaluates it
  against local time, and enforces it:
  - **Websites** - a managed section in the OS hosts file, applied by a small
    privileged helper you approve once (macOS LaunchDaemon / Windows SYSTEM
    scheduled task). Works in every browser.
  - **Apps** - a watcher terminates blocked apps within ~5 s of launch.
- Ships **usage events** (blocking applied, app kill attempts, heartbeats)
  back to the server - the raw material for your daily AI usage digest and,
  later, friends leaderboards.
- Works **offline** from the last cached schedule.

## Install

Grab the latest `.dmg` (macOS) or `.exe` installer (Windows) from
[Releases](https://github.com/Yawningface/yawningface/releases/latest).

The builds are not notarized with Apple / signed with a paid certificate yet
(macOS builds are ad-hoc signed so the app isn't reported as "damaged"):

- **macOS**: right-click the app → Open (first launch only). If macOS still
  refuses, run `xattr -cr /Applications/yawningface.app`.
- **Windows**: SmartScreen → "More info" → "Run anyway".

## Configure

Official builds come pre-configured. If you self-host (or build locally), open
**Settings** in the app and fill in:

| Field | Example |
|---|---|
| Server URL | `https://your-block-cloud.vercel.app` |
| Auth0 domain | `your-tenant.eu.auth0.com` |
| Auth0 client ID | from your Auth0 Native application |
| Auth0 audience | your Auth0 API identifier, e.g. `https://block-api` |

The full self-host walkthrough is in the
[`block_cloud` setup guide](https://github.com/Yawningface/block_cloud).

## Develop

The daily loop on Windows is one script. It stops the installed copy, runs
the latest code, and restores the installed copy afterwards; blocking keeps
working throughout because both builds share the same spool, scheduled task,
and config:

```powershell
cd apps/desktop
.\dev.ps1           # hot reload: UI edits appear instantly, Ctrl+C to stop
.\dev.ps1 -Once     # standalone release exe of the current code, no installer
.\dev.ps1 -Restore  # bring the installed app back
```

Manually:

```bash
npm install
npm run tauri dev        # run the app
cd src-tauri && cargo test   # engine unit tests
npm run tauri build      # local production bundle
```

Build-time defaults can be injected via env vars: `YF_API_BASE`,
`YF_AUTH0_DOMAIN`, `YF_AUTH0_CLIENT_ID`, `YF_AUTH0_AUDIENCE` (see
`.github/workflows/release.yml` - set them as GitHub repository variables).

Releases: `git tag v0.x.y && git push --tags` → GitHub Actions builds the
macOS dmg + Windows installer and attaches them to a draft release.

## Architecture

```
src-tauri/src/
  lib.rs                Tauri setup: tray, window, commands, background loops
  auth.rs               Auth0 device authorization flow + token refresh
  sync.rs               30 s engine tick: pull config -> evaluate -> apply -> ship events
  schedule.rs           blocklist JSON -> "what must be blocked right now"
  settings.rs           persisted settings + tokens
  blocking/hosts.rs     managed hosts-file section + spool file
  blocking/apps.rs      process watcher / killer
  blocking/lock.rs      Tough Mode lock state + request (macOS)
  blocking/platform.rs  one-time privileged helper install (admin prompt)
```

**Why the helper?** Editing the hosts file needs root/admin. Instead of asking
for a password at every schedule boundary, one admin prompt installs a tiny
applier owned by root/SYSTEM:

- macOS: `/Library/LaunchDaemons/org.yawningface.block.hostsd.plist` watches a
  user-writable spool file and applies it instantly.
- Windows: scheduled task `YawningFaceBlockHosts` (SYSTEM) applies the spool
  every minute.

The applier re-validates every domain against a strict charset and only ever
writes `0.0.0.0` entries inside clearly marked BEGIN/END lines - a tampered
spool can block sites, never redirect them.

## Tough Mode (macOS)

For the "lock me out, no way back" user (see
[product/tough-block-persona.md](../../product/tough-block-persona.md)). The
app writes a lock *request* (end time + domains); the root applier merges it
monotonically into a root-owned lock file - the end time can only move later
(max 7 days), domains can only be added. While locked:

- the locked domains stay in the hosts file no matter what the app or spool
  says (quitting or deleting the app changes nothing);
- launchd watches `/etc/hosts` and re-asserts the block if it is hand-edited;
- there is deliberately no code path that ends the lock early - it expires
  when the clock passes the end time (checked at least every 60 s).

**Uninstall the helper**: macOS  - 
`sudo launchctl bootout system/org.yawningface.block.hostsd && sudo rm /Library/LaunchDaemons/org.yawningface.block.hostsd.plist "/Library/Application Support/YawningFaceBlock/apply-hosts.sh"`;
Windows - `schtasks /Delete /TN YawningFaceBlockHosts /F` (elevated) and delete
`C:\ProgramData\YawningFaceBlock`. Both leave the hosts file clean after the
managed section is emptied.

## Honest limitations (v0.1)

- Hosts-file blocking can be bypassed by browsers using DNS-over-HTTPS and by
  editing the hosts file as admin. It's friction, not a prison - pair it with
  the Chrome extension for request-level blocking.
- App matching is by process name (prefix, case-insensitive).
- Outside Tough Mode, quitting the app stops enforcement of scheduled blocks.
- Tough Mode is macOS-only and hosts-level (websites, not apps). An admin can
  still defeat it with `sudo` - it's SelfControl-grade friction, not a prison.
  Planned hardening: helper refuses self-removal while locked, PF second
  layer, cloud lock ledger.

MIT © Yawningface
