# Install the yawningface browser companion

Requirements:

- yawningface desktop **v0.2.16 or newer** installed and opened once;
- the browser companion **v0.1.3 or newer**; and
- Chrome 120+ or current Microsoft Edge.

Until a browser-store release exists, install the official GitHub build as an
unpacked extension. Unpacked extensions update manually.

## From a GitHub Release ZIP

1. Download `yawningface-extension-vX.Y.Z-unpacked.zip` and
   `SHA256SUMS.txt` from the matching official yawningface GitHub Release.
2. Optionally verify the ZIP's SHA-256.
3. Extract it to a permanent folder such as
   `Documents\yawningface-extension`.
4. Confirm `manifest.json` is directly inside that folder.

Do not select the ZIP itself and do not delete the extracted folder while the
extension is installed.

## Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the extracted folder containing `manifest.json`.
5. Pin yawningface from Chrome's Extensions menu.
6. Open yawningface desktop. The companion popup should say **Connected to
   yawningface desktop** or show the current blocked-site count.

## Microsoft Edge

Use the same steps at `edge://extensions`.

## Build from source

From the repository root:

```bash
npm install
npm run build -w @yawningface/extension
```

Then load `apps/extension/dist` as the unpacked folder.

## Update

1. Replace the contents of the existing permanent extension folder with the
   new release contents.
2. Return to `chrome://extensions` or `edge://extensions`.
3. Click **Reload** on yawningface.
4. Open **Companion details** and confirm the expected version and a connected
   desktop state.

The pinned extension identity preserves the native bridge permission. If the
popup says desktop is disconnected, update/open desktop and click **Refresh
from desktop**.

## Remove

Click **Remove** on the browser's extension page. This does not remove or
disable yawningface desktop; native hosts blocking will continue when desktop
has an active session or schedule.

## Manual-install limitations

- Developer mode must remain enabled.
- Updates are manual.
- Chrome may show development-mode warnings.
- A normal direct install and automatic updates require a browser store.
