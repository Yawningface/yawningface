# Install the yawningface browser extension

Until the extension is published in Chrome Web Store and Microsoft Edge
Add-ons, it must be loaded manually as an unpacked extension.

Only install an unpacked build downloaded from the official Yawningface GitHub
repository or built from source you trust. Unpacked extensions do not update
automatically.

## From a GitHub Release ZIP

When extension release assets are available:

1. Open the matching release in the Yawningface GitHub repository.
2. Download **yawningface-extension-vX.Y.Z-unpacked.zip** and
   **SHA256SUMS.txt**.
3. Optionally verify the ZIP SHA-256 against the checksum file.
4. Extract the ZIP to a permanent folder, such as:

       Documents\yawningface-extension

5. Confirm that **manifest.json** is directly inside that folder.

Do not load the ZIP itself, and do not delete the extracted folder while the
extension is installed.

## Chrome

1. Enter **chrome://extensions** in the address bar.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select the extracted folder containing **manifest.json**.
5. Open Chrome's Extensions menu and pin yawningface.
6. Click the yawningface icon to start a working session.

## Microsoft Edge

1. Enter **edge://extensions** in the address bar.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the extracted folder containing **manifest.json**.
5. Pin yawningface from the Extensions menu.

## Build and install from source

From the repository root:

    npm install
    npm run build -w @yawningface/extension

Then use Load unpacked and select:

    apps/extension/dist

## Update a manually installed build

1. Download and extract the new release.
2. Replace the files in the same permanent extension folder.
3. Return to **chrome://extensions** or **edge://extensions**.
4. Click **Reload** on the yawningface extension card.
5. Confirm that the displayed version matches the release.

Keeping the stable extension identity preserves local settings and attempt
counts. Export **yawningface.json** from extension options before any manual
remove-and-reinstall operation.

## Remove

Open the browser extensions page and click **Remove** on yawningface. Removing
the browser extension does not remove or disable the yawningface desktop app.

## Limitations of manual installation

- Developer mode must remain enabled.
- Updates are manual.
- Chrome may display development-mode warnings.
- A GitHub-hosted CRX is not a normal direct-install route on unmanaged Windows
  or macOS computers.
- General-user installation and automatic updates require a browser store.
