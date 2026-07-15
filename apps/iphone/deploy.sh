#!/usr/bin/env bash
#
# Put the iPhone app on the phone (or the simulator) in one command, driven
# from the Windows machine over SSH to the Mac mini.
#
#   ./deploy.sh            build, sign, install and launch on the iPhone
#   ./deploy.sh sim        build, install and launch on the simulator, and
#                          pull a screenshot back to ./shot.png
#
# Why it is shaped like this: codesign cannot reach the login keychain from a
# plain SSH session (it fails with errSecInternalComponent), so the *signed*
# device build is run inside the Mac's GUI session through a .command file,
# which Finder opens in that session. The simulator needs no signing, so that
# path runs straight over SSH.
#
# Requires ~/.ssh/config to define a host `mini`. See the skill:
#   .claude/skills/claude-autonomous-iphone-development/SKILL.md

set -euo pipefail

MINI=mini
BUNDLE=yawningface.block
# Remote paths use a literal $HOME so the local (MSYS/Windows) bash does not
# expand ~ to a C:\ path before the string reaches the Mac.
REMOTE='$HOME/yawningface/apps/iphone'
MODE="${1:-device}"

cd "$(dirname "$0")/../.."   # repo root

echo "==> checking the mini is reachable"
ssh -o ConnectTimeout=10 "$MINI" "true" || {
  echo "Cannot reach '$MINI'. Is the mini awake and on the LAN? See the skill." >&2
  exit 1
}

# Disk is the recurring hazard: Xcode + one runtime is ~35 GB and Docker's
# image balloons over time. A build needs ~1 GB free; warn well before that.
free_gb=$(ssh "$MINI" "df -g / | tail -1 | awk '{print \$4}'")
if [ "${free_gb:-99}" -lt 3 ]; then
  echo "WARNING: only ${free_gb} GB free on the mini. Builds may fail; see the skill's Disk section." >&2
fi

echo "==> syncing apps/iphone to the mini"
tar czf - apps/iphone | ssh "$MINI" "mkdir -p ~/yawningface && tar xzf - -C ~/yawningface"

# ---------------------------------------------------------------- simulator ---
if [ "$MODE" = "sim" ]; then
  echo "==> ensuring a booted simulator"
  ssh "$MINI" '
    dev=$(xcrun simctl list devices booted | grep -oE "[0-9A-F-]{36}" | head -1)
    if [ -z "$dev" ]; then
      dev=$(xcrun simctl list devices | grep -oE "[0-9A-F-]{36}" | head -1)
      [ -z "$dev" ] && dev=$(xcrun simctl create yf-iphone "iPhone 17 Pro" \
        "com.apple.CoreSimulator.SimRuntime.iOS-26-5")
      xcrun simctl boot "$dev" 2>/dev/null || true
    fi
    echo "$dev" > /tmp/yf-sim-udid'

  echo "==> building for the simulator"
  ssh "$MINI" "cd $REMOTE && xcodebuild -project YawningFace.xcodeproj -target YawningFace \
      -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO \
      CONFIGURATION_BUILD_DIR=/tmp/yfsim build 2>&1 \
      | grep -E 'error:|BUILD SUCCEEDED|BUILD FAILED'"

  echo "==> installing, launching, screenshotting"
  ssh "$MINI" "
    sim=\$(cat /tmp/yf-sim-udid)
    xcrun simctl install \$sim /tmp/yfsim/YawningFace.app
    xcrun simctl terminate \$sim $BUNDLE 2>/dev/null || true
    xcrun simctl launch \$sim $BUNDLE >/dev/null
    sleep 4
    xcrun simctl io \$sim screenshot ~/yf-shot.png >/dev/null 2>&1"
  scp -q "$MINI":'~/yf-shot.png' ./shot.png
  echo "==> screenshot at ./shot.png  (open it / Read it)"
  exit 0
fi

# ------------------------------------------------------------------- device ---
echo "==> finding the connected iPhone"
DEVICE=$(ssh "$MINI" "xcrun devicectl list devices 2>/dev/null \
  | grep -i 'connected' | grep -iE 'iphone' | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | head -1")
if [ -z "$DEVICE" ]; then
  echo "No connected iPhone. Plug it in, unlock it, tap Trust. See the skill." >&2
  exit 1
fi
echo "    device: $DEVICE"

# The build must run in the Mac's GUI session for keychain access.
echo "==> building signed + installing (runs in the Mac GUI session)"
ssh "$MINI" "cat > ~/yf-install.command <<EOF
#!/bin/zsh
cd \$HOME/yawningface/apps/iphone
xcodebuild -project YawningFace.xcodeproj -target YawningFace \\
  -destination 'id=$DEVICE' -allowProvisioningUpdates \\
  CONFIGURATION_BUILD_DIR=/tmp/yfdev build > /tmp/gui-build.log 2>&1
if grep -q 'BUILD SUCCEEDED' /tmp/gui-build.log; then
  xcrun devicectl device install app --device $DEVICE /tmp/yfdev/YawningFace.app > /tmp/gui-install.log 2>&1
  echo DONE >> /tmp/gui-install.log
else
  echo FAILED > /tmp/gui-install.log
fi
EOF
chmod +x ~/yf-install.command
rm -f /tmp/gui-build.log /tmp/gui-install.log
open ~/yf-install.command"

echo -n "==> waiting for the GUI build"
until ssh "$MINI" "grep -qE 'DONE|FAILED' /tmp/gui-install.log 2>/dev/null"; do
  echo -n "."
  sleep 10
done
echo

if ssh "$MINI" "grep -q FAILED /tmp/gui-install.log"; then
  echo "BUILD FAILED. Last errors:" >&2
  ssh "$MINI" "grep -E 'error:|errSec' /tmp/gui-build.log | head -10" >&2
  exit 1
fi

echo "==> installed. launching on the phone"
launch=$(ssh "$MINI" "xcrun devicectl device process launch --device $DEVICE $BUNDLE 2>&1" || true)
if echo "$launch" | grep -qi "launched application"; then
  echo "    launched."
elif echo "$launch" | grep -qi "locked"; then
  echo "    installed OK, but the phone is locked - unlock it and open the app yourself."
else
  echo "$launch" | grep -iE 'launched|error' | head -3
fi
echo "==> done"
