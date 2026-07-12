---
name: claude-autonomous-iphone-development
description: Use when setting up or running the remote iPhone development loop - building, launching, screenshotting, and iterating apps/iphone on the Tailscale Mac mini from the Windows machine (or autonomously on the mini itself), including serve-sim streaming and on-device testing.
---

# Claude autonomous iPhone development

The levelsio pattern (agent → SSH → headless Mac → `xcodebuild`/`simctl` →
screenshots → vision → iterate), adapted to Xuban's hardware: **no MacinCloud
rental - his own Mac mini is already on Tailscale** (it self-hosts
boringtube-2), and this Windows machine is on the same tailnet. Total cost: $0.

```
Windows (this box)                     Mac mini (tailnet)
Claude Code, repo clone   --SSH/scp--> Xcode + iOS Simulator + serve-sim
edits Swift, reads shots  <--git------ repo clone, builds & runs the app
        │                                   │
        └── browser http://localhost:3200 ──┘   (serve-sim over ssh -L)
                                            └── physical iPhone via USB
                                                (devicectl, Screen Time tests)
```

## ⚠️ The constraint levelsio doesn't have

**FamilyControls / ManagedSettings / DeviceActivity do NOT work in the
Simulator.** The simulator loop covers UI, onboarding, sync, the coach screen
 -  ~90% of remaining work - but shields only fire on a **physical iPhone**
(plug it into the mini, see "On-device", and [[ios-screentime]]). Keep the
blocking engine behind a protocol with a simulator mock so the loop never
stalls on it.

## Facts for this specific setup (fill on first contact, then update this file)

| Fact | Value |
| --- | --- |
| Mini Tailscale hostname | `<TODO: tailscale status on either machine>` |
| macOS user on the mini | `<TODO>` |
| SSH alias | `mini` (via ~/.ssh/config, below) |
| Xcode version on mini | `<TODO: ssh mini "xcodebuild -version">` |
| Scheme / bundle id | `<TODO: xcodebuild -list>` - expect scheme `YawningFace`, bundle id from build settings |
| Chosen simulator | `<TODO: xcrun simctl list devices available>` - prefer a recent iPhone |

## One-time setup

**Windows side** (PowerShell; OpenSSH client is built in):
```powershell
ssh-keygen -t ed25519            # if no key yet
type $env:USERPROFILE\.ssh\id_ed25519.pub   # copy this
Add-Content $env:USERPROFILE\.ssh\config "`nHost mini`n  HostName <mini-magicdns>`n  User <macuser>"
```

**Mac mini side** (Xuban does this once, physically or via existing access):
1. System Settings → General → Sharing → **Remote Login: on** (Tailscale's
   macOS app doesn't provide an SSH server; use macOS's own).
2. Append the Windows public key to `~/.ssh/authorized_keys`.
3. Full Xcode installed (not just CLT), then:
   `sudo xcode-select -s /Applications/Xcode.app && sudo xcodebuild -license accept && xcodebuild -runFirstLaunch && xcodebuild -downloadPlatform iOS`
4. Node LTS (for serve-sim) and a clone of the repo:
   `git clone https://github.com/Yawningface/yawningface.git ~/yawningface`

**Verify from Windows:** `ssh mini "sw_vers && xcodebuild -version && xcrun simctl list devices available | head"`

## Loop A - Windows-driven (recommended start; every step versioned)

Claude Code runs here with native file tools; the mini is the build farm.

```bash
# 1. edit Swift files locally in apps/iphone, commit, push
git push

# 2. build on the mini (simulator builds need no signing)
ssh mini 'cd ~/yawningface && git pull --ff-only && cd apps/iphone && \
  xcodebuild -project YawningFace.xcodeproj -scheme YawningFace \
    -configuration Debug -destination "platform=iOS Simulator,name=iPhone 16" \
    -derivedDataPath build CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -20'

# 3. install + launch in the (headless) simulator
ssh mini 'xcrun simctl boot "iPhone 16" 2>/dev/null; \
  xcrun simctl install booted ~/yawningface/apps/iphone/build/Build/Products/Debug-iphonesimulator/YawningFace.app && \
  xcrun simctl launch booted <bundle-id>'

# 4. screenshot, pull it back, LOOK at it
ssh mini 'xcrun simctl io booted screenshot /tmp/yf.png'
scp mini:/tmp/yf.png ./shot.png     # then Read shot.png (vision)
```

Then judge the screenshot against `docs/STYLE_GUIDE.md` (bg `#111926`, card
`#1F2937`, yawn-yellow `#FACC16`, pill buttons, 😴/😎 hero) and the task's
acceptance criteria; fix; repeat. Logs when something crashes:
`ssh mini 'xcrun simctl spawn booted log show --last 2m --predicate "process == \"YawningFace\"" | tail -40'`

## Loop B - autonomous on the mini (fast iteration / overnight)

Install Claude Code on the mini and run it there in `~/yawningface` - native
Edit/Read tools, no git round-trip per cycle, sessions keep running when the
Windows box sleeps. Xuban prompts it via Termius (phone) or `ssh mini` and
watches through serve-sim. Commit/push at every green step so Loop A's clone
never diverges. Use Loop B for grinding UI polish; Loop A for reviewed,
structural changes.

## serve-sim - feel the app from Windows

```bash
ssh mini 'cd ~ && (xcrun simctl boot "iPhone 16" 2>/dev/null); npx serve-sim'   # leave running
# separate Windows terminal - tunnel, then browse http://localhost:3200
ssh -L 3200:localhost:3200 mini
```
60 FPS MJPEG stream + click/gesture control in the browser. Evan Bacon's repo
(github.com/EvanBacon/serve-sim) also ships an **agent skill** (`skills/serve-sim`)
that teaches agents to drive gestures/taps/typing - install it on whichever
machine runs the agent when interaction-testing is needed.

## On-device (the Screen Time 10%)

Physical iPhone plugged into the mini via USB, trusted, Developer Mode on:
```bash
ssh mini 'xcrun devicectl list devices'
ssh mini 'xcrun devicectl device install app --device <udid> <path-to-.app>'
```
Device builds need real signing (Xuban's Apple ID team in Xcode on the mini);
distribution/TestFlight additionally needs the **Family Controls entitlement**
 -  the request form is the project's longest lead-time item ([[ios-screentime]]).

## Recommended early improvements

1. **XcodeGen**: replace the checked-in `.xcodeproj` with a text-native
   `project.yml` (levelsio's trick) - agent-editable, merge-friendly,
   regenerate with `xcodegen generate`. Do it before heavy UI iteration.
2. First missions once the loop is live: the `selectedDays` bug, contract
   adoption, onboarding polish - all in `apps/iphone/PORT_NOTES.md`.

## Gotchas

- Non-interactive SSH has a minimal PATH; `xcodebuild`/`xcrun` live in
  `/usr/bin` and work, but anything installed via Homebrew may need
  `/opt/homebrew/bin/` prefixed.
- If `simctl` errors about developer dir: `sudo xcode-select -s /Applications/Xcode.app` on the mini.
- Simulator device names drift with Xcode versions - always discover with
  `xcrun simctl list devices available` instead of assuming.
- First boot of a simulator is slow (~1 min); keep it booted between cycles.
- `git pull --ff-only` on the mini fails if Loop B committed without pushing  - 
  resolve on the mini, never force-push from Windows.
- Keep secrets off the mini clone; it needs no `.env` (the coach runs where
  Claude runs, not in the iPhone app).
