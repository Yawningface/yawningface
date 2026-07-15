---
name: claude-autonomous-iphone-development
description: Use when building, running, screenshotting, or flashing apps/iphone (the YawningFace Screen Time app) from the Windows machine by driving the Mac mini over SSH. Covers the one-command deploy loop, simulator vs real device, the codesigning keychain wall, editing the Xcode project headlessly, and every error we have actually hit.
---

# Developing the iPhone app from Windows, via the Mac mini

The iPhone app (`apps/iphone`) can only be built on a Mac. We do not own a Mac
workstation to sit at; we own a **headless Mac mini on the same WiFi**. So the
whole loop is: edit Swift on Windows -> push the source to the mini over SSH ->
`xcodebuild` there -> install on the simulator or the real iPhone -> screenshot
-> look -> repeat. This file is a runbook: follow it top to bottom and the loop
works. Every command here was run live and verified.

## TL;DR - the one command

From the repo root on Windows (Git Bash / the Bash tool):

```bash
./apps/iphone/deploy.sh sim     # build -> simulator -> pull ./shot.png (then Read it)
./apps/iphone/deploy.sh         # build -> SIGN -> install + launch on the real iPhone
```

`deploy.sh` does the sync, the build, the signing dance, the install and the
launch, and prints where it got stuck if it fails. If that command works you do
not need the rest of this file. Read on when it does not, or when you are
setting the machine up from scratch, or when you need to change the Xcode
project.

## The mental model (read this once)

- **The mini is a build slave, not a workstation.** Nobody looks at its screen.
  It is reached only by `ssh mini`.
- **Source gets there by tar-over-SSH, never git.** The repo is private, org
  policy disables deploy keys, and the mini's key is not on GitHub. Do not try
  to `git pull` on the mini. `deploy.sh` does `tar czf - apps/iphone | ssh mini
  "tar xzf - -C ~/yawningface"`. It is instant on the LAN and needs no
  credentials.
- **Two build paths, and they differ only in signing.** The **simulator** needs
  no signing, so it runs straight over SSH. The **real device** must be
  code-signed, and here is the one hard truth of this whole setup:

  > **codesign cannot reach the login keychain from a plain SSH session.** It
  > fails with `errSecInternalComponent`. The private signing key lives in the
  > GUI login session, and an SSH session is not in it.

  The fix, which `deploy.sh` automates: write the build commands into a
  `~/yf-install.command` file and `open` it. Finder runs `.command` files
  **inside the GUI session**, where the keychain is reachable. That is why the
  device path looks convoluted; it has to be.

- **The Simulator cannot run Screen Time.** FamilyControls / DeviceActivity /
  ManagedSettings and the shield extensions **do nothing in the Simulator** -
  Apple only implements them on real hardware. Use the simulator for UI, layout,
  onboarding, navigation, Insights rendering. Use the **real iPhone** for
  anything that actually blocks. See [[ios-screentime]].

## One-time setup

### On the mini (physically, or over an existing session)

1. **Remote Login on:** System Settings -> General -> Sharing -> Remote Login.
   (Verify from Windows with the SSH test below. Do not assume Tailscale gives
   you SSH; it does not - this uses macOS's own sshd over the LAN.)
2. **Authorize this Windows machine.** Append its public key to
   `~/.ssh/authorized_keys` (mode 600, `~/.ssh` mode 700). The current key is:
   ```
   ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIErUsVrfOpTvOAlj95PfadqTKchrxDE/y0uIq6pfdL5v usuario@DESKTOP-FS8CV97
   ```
3. **Xcode + iOS platform.** Full Xcode.app (not just Command Line Tools), then
   the iOS simulator runtime:
   ```bash
   sudo xcode-select -s /Applications/Xcode.app
   sudo xcodebuild -license accept
   xcodebuild -downloadPlatform iOS        # ~8.5 GB, no sudo needed
   ```
4. **Sign in to Xcode once, on the GUI.** Xcode -> Settings -> Accounts -> add
   the Apple ID that owns team `25B5ZT342A`. The first device build must be run
   from the Xcode GUI (press Run once) so it can answer the "revoke/create
   certificate" and keychain prompts. After that, headless signing works.
5. **Ruby gem for project edits** (only if you will add targets):
   `gem install --user-install xcodeproj` (already installed).

### On the iPhone (once)

- Settings -> Privacy & Security -> **Developer Mode: On** (reboots the phone).
- Plug into the mini by USB, tap **Trust**, enter the passcode.
- First launch of a dev-signed app: Settings -> General -> VPN & Device
  Management -> trust the developer certificate.

### On Windows (once)

`~/.ssh/config` must contain:
```
Host mini
    HostName xubans-mac-mini.local
    User xubanceccon
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking accept-new
    ServerAliveInterval 30

Host mini-lan
    HostName 192.168.1.134
    User xubanceccon
    IdentityFile ~/.ssh/id_ed25519
```
`mini` uses the mDNS name (survives DHCP changes); `mini-lan` is the hardcoded
IP fallback if mDNS is flaky.

**Verify the whole chain in one line:**
```bash
ssh mini "sw_vers -productVersion && xcodebuild -version | head -1 && \
  xcrun simctl list runtimes | grep -i ios && \
  xcrun devicectl list devices | grep -i iphone"
```
You want: a macOS version, an Xcode version, an iOS runtime, and a phone whose
state is `connected` (not `unavailable`).

## The daily loop

**UI work (fast, no phone needed):**
```bash
# edit Swift in apps/iphone/... on Windows, then:
./apps/iphone/deploy.sh sim
# Read ./shot.png and judge it against docs/STYLE_GUIDE.md
```
Judge against the current design system: **paper `#faf9f4`, ink `#12120f`, one
yellow `#f0db0c`, Geist for UI, Instrument Serif only for the brand wordmark.**
(The old style guide's dark navy is obsolete; the app now matches the desktop
and the website.)

**Real blocking / on-device (needs the phone connected + unlocked):**
```bash
./apps/iphone/deploy.sh
# then, on the phone, start a session and try to open a blocked app
```

## Editing the Xcode project without Xcode

The project has four targets: `YawningFace`, `DeviceActivityMonitorExtension`,
`ShieldConfigurationExtension`, `ShieldActionExtension`. **Never hand-edit
`project.pbxproj`.** Structural changes (new target, new extension) are done by
an idempotent Ruby script committed in the repo, e.g.
`apps/iphone/add-shield-targets.rb`, run on the mini with the `xcodeproj` gem:

```bash
tar czf - apps/iphone | ssh mini "tar xzf - -C ~/yawningface"
ssh mini "export PATH=/opt/homebrew/bin:\$PATH; cd ~/yawningface/apps/iphone && ruby add-shield-targets.rb"
# then pull the regenerated project back so it is version-controlled:
scp mini:'~/yawningface/apps/iphone/YawningFace.xcodeproj/project.pbxproj' \
    apps/iphone/YawningFace.xcodeproj/project.pbxproj
```
Model any new script on that one. Watch two things it gets right that are easy
to miss: every extension's `Info.plist` needs a real `CFBundleIdentifier`
(`$(PRODUCT_BUNDLE_IDENTIFIER)`), or the build fails with "embedded binary's
bundle identifier is not prefixed"; and the extension must be added to the app's
**Embed Foundation Extensions** copy-files phase, or it silently will not ship.

> **Gotcha that will bite you:** `tar`-syncing `apps/iphone` from Windows
> **overwrites `project.pbxproj` on the mini**. If you edited the project on the
> mini and have not pulled it back, the next `deploy.sh` clobbers your changes.
> Always pull the project file back into the repo immediately after a project
> edit.

## Targets and bundle ids (facts)

| Thing | Value |
| --- | --- |
| App target / bundle id | `YawningFace` / `yawningface.block` |
| Team (automatic signing) | `25B5ZT342A` (has the Family Controls entitlement) |
| Extensions | `...block.DeviceActivityMonitorExtension`, `...block.ShieldConfigurationExtension`, `...block.ShieldActionExtension` |
| App Group (shared storage) | `group.yawningface.block` |
| No shared schemes | build with `-target YawningFace`, never `-scheme` |
| Source on the mini | `~/yawningface/apps/iphone` |

## Troubleshooting - every error we have actually hit

| Symptom | Cause & fix |
| --- | --- |
| `Cannot reach 'mini'` / ssh hangs | Mini asleep or off the LAN. Wake it. Try `ssh mini-lan`. Confirm same WiFi. |
| `errSecInternalComponent` during CodeSign | The keychain wall. You ran a *signed* build over plain SSH. Use `deploy.sh` (device path), which runs the build in the GUI session via a `.command` file. Never `ssh mini xcodebuild ...` for a device build. |
| `Revoke certificate ... private key is not in this keychain` | First device signing on this Mac. Must be answered once in the **Xcode GUI**: open the project on the mini (`ssh mini "open ~/yawningface/apps/iphone/YawningFace.xcodeproj"`), press Run, choose "Revoke and Create", allow keychain access ("Always Allow"). Headless works after that. |
| `PLA Update available ... agree to the latest Program License Agreement` | Apple changed the license. Sign in at developer.apple.com/account and accept the new agreement. No profiles issue until you do. |
| `No profiles for 'yawningface.block...' were found` | Usually a downstream symptom of the two rows above (PLA not accepted, or cert/keychain). Fix those first, rebuild with `-allowProvisioningUpdates`. |
| `device was not, or could not be, unlocked` (error 7 / Locked) | **Not a failure.** The build + install SUCCEEDED; the phone was locked at launch. Unlock it and open the app, or re-run. `deploy.sh` now reports this plainly. |
| iPhone shows `unavailable` in `devicectl list devices` | Locked, unplugged, or trust expired. Unlock, re-seat USB, re-tap Trust. |
| `BUILD FAILED ... iOS 26.5 Platform Not Installed` | The simulator runtime is still downloading, or CoreSimulator is stale. Wait for `xcodebuild -downloadPlatform iOS`; if it says Ready but `simctl list runtimes` is empty, `killall -9 com.apple.CoreSimulator.CoreSimulatorService`. |
| `Invalid runtime` when creating a sim | Pass the full runtime id, e.g. `com.apple.CoreSimulator.SimRuntime.iOS-26-5`, discovered from `xcrun simctl list runtimes`. |
| Homebrew tool "command not found" over SSH | Non-interactive SSH has a minimal PATH. Prefix: `export PATH=/opt/homebrew/bin:$PATH`. (`xcodebuild`/`xcrun`/`simctl` are in `/usr/bin` and always work.) |
| `~` becomes a `C:\...` path on the mini | Local MSYS bash expands `~` before sending. In remote command strings use a single-quoted `$HOME` (expands on the Mac), not `~`. This bit `deploy.sh` once. |

## Disk - the recurring hazard

Xcode + one iOS runtime is ~35 GB, and the mini also self-hosts Docker
(boringtube-2, xupanel, blogbot, portainer) whose disk image **balloons over
time** back toward 24 GB. Free space drifts down to a few GB and then builds
fail. `deploy.sh` warns under 3 GB. To reclaim, in order of safety:

```bash
ssh mini "df -h /"                                   # check first
# safe, re-downloadable caches:
ssh mini "rm -rf ~/Library/Developer/Xcode/DerivedData ~/Library/Caches/Homebrew"
# Docker without touching the running services or boringtube's media volume:
ssh mini "docker image prune -af && docker builder prune -af"
ssh mini "docker run --rm --privileged --pid=host docker/desktop-reclaim-space"  # shrinks the sparse image
```
**Never** delete the `boringtube-2_media-data` volume or run `docker system
prune --volumes` blindly - that is the user's data and it is not backed up.

## Facts (confirmed live, 2026-07)

| Fact | Value |
| --- | --- |
| Reach | LAN over mDNS. `ssh mini` -> `xubans-mac-mini.local` -> `192.168.1.134`. No Tailscale. |
| macOS user | `xubanceccon` |
| macOS / chip | 26.3.x, Apple silicon (arm64) |
| Xcode | 26.6, at `/Applications/Xcode.app`, xcode-select'ed |
| iOS runtime | iOS 26.5 Simulator |
| iPhone | iPhone 15, UDID `BC9CD673-B180-5D20-A854-CDF678FD2458` (deploy.sh discovers it) |
| sudo | needs a password; nothing root can be automated over SSH |
| Verified loop | `deploy.sh sim` builds + screenshots; `deploy.sh` builds + signs + installs in ~30 s (launch needs the phone unlocked). |

## Optional: serve-sim (feel the sim from Windows)

Not currently set up or verified here. If you want live interaction rather than
one-shot screenshots: `ssh mini "npx serve-sim"` streams the booted simulator;
tunnel with `ssh -L 3200:localhost:3200 mini` and open `http://localhost:3200`.
Evan Bacon's repo ships an agent skill for driving taps. Treat as experimental
until proven in this setup - the screenshot loop above is what is known to work.
