#!/usr/bin/env bash
#
# Push the iPhone app from Windows to the phone, in one command.
#
#   ./deploy.sh            build + install + launch on the iPhone
#   ./deploy.sh sim        build + install + launch on the simulator, and
#                          pull a screenshot back to ./shot.png
#
# Why it is shaped like this: codesign cannot reach the login keychain from an
# SSH session (errSecInternalComponent), so the signed build is launched inside
# the Mac's GUI session through a .command file. The simulator needs no signing,
# so that path runs straight over SSH.

set -euo pipefail

MINI=mini
DEVICE=BC9CD673-B180-5D20-A854-CDF678FD2458   # Xuban's iPhone
BUNDLE=yawningface.block
REMOTE=~/yawningface/apps/iphone
MODE="${1:-device}"

cd "$(dirname "$0")/../.."   # repo root

echo "==> syncing source to the mini"
tar czf - apps/iphone | ssh "$MINI" "mkdir -p ~/yawningface && tar xzf - -C ~/yawningface"

if [ "$MODE" = "sim" ]; then
  echo "==> building for the simulator"
  ssh "$MINI" "cd $REMOTE && xcodebuild -project YawningFace.xcodeproj -target YawningFace \
      -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO \
      CONFIGURATION_BUILD_DIR=/tmp/yfsim build 2>&1 | grep -E 'error:|BUILD SUCCEEDED|BUILD FAILED'"

  echo "==> installing and launching on the simulator"
  ssh "$MINI" "xcrun simctl boot yf-iphone 2>/dev/null; \
      xcrun simctl install booted /tmp/yfsim/YawningFace.app && \
      xcrun simctl terminate booted $BUNDLE 2>/dev/null; \
      xcrun simctl launch booted $BUNDLE >/dev/null && sleep 4 && \
      xcrun simctl io booted screenshot ~/yf-shot.png >/dev/null 2>&1"
  scp -q "$MINI":~/yf-shot.png ./shot.png
  echo "==> screenshot at ./shot.png"
  exit 0
fi

# Device path: the build has to run in the Mac's GUI session for the keychain.
echo "==> building signed + installing on the iPhone (GUI session)"
ssh "$MINI" "cat > ~/yf-install.command <<'EOF'
#!/bin/zsh
cd ~/yawningface/apps/iphone
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

echo -n "==> waiting for the build"
until ssh "$MINI" "grep -qE 'DONE|FAILED' /tmp/gui-install.log 2>/dev/null"; do
  echo -n "."
  sleep 10
done
echo

if ssh "$MINI" "grep -q FAILED /tmp/gui-install.log"; then
  echo "BUILD FAILED:"
  ssh "$MINI" "grep -E 'error:|errSec' /tmp/gui-build.log | head -10"
  exit 1
fi

echo "==> launching on the phone"
ssh "$MINI" "xcrun devicectl device process launch --device $DEVICE $BUNDLE 2>&1 | grep -iE 'launched|error'"
