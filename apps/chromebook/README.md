# apps/chromebook — planned ChromeOS target

Status: **design placeholder only; no dedicated Chromebook client is shipped.**

ChromeOS should be extension-first. Most of the implementation belongs in
[`apps/extension`](../extension); this directory is reserved for ChromeOS-only
integration notes, test fixtures, store assets, and any future companion code.

## Intended shape

- **Websites:** use the Manifest V3 extension and its
  `declarativeNetRequest` rules. It must evaluate cached contract state locally
  and continue blocking while offline.
- **Cross-device sessions:** receive the same session fan-out events as desktop
  and mobile clients; config sync alone is not sufficient.
- **Android apps on ChromeOS:** investigate reusing the planned
  [`apps/android`](../android) client on Play-enabled Chromebooks. ChromeOS does
  not expose a general consumer API for killing arbitrary native/Linux apps,
  so the UI must state the enforcement boundary honestly.
- **Managed Chromebooks:** enterprise policy deployment may improve extension
  persistence, but it is an optional administrator path—not a requirement for
  the consumer product.
- **Contract:** no ChromeOS-specific schema. The extension/mobile companion
  must speak the same canonical config and event protocol as every client.

## Before calling it supported

- [ ] Install and exercise the extension on current ChromeOS Stable hardware.
- [ ] Verify offline website blocking, browser restarts, profile switching,
      exceptions, and cross-device session latency.
- [ ] Test unmanaged personal accounts separately from managed/school devices.
- [ ] Document exactly which Android, Linux-container, and system surfaces are
      outside enforcement.
- [ ] Add ChromeOS-focused automated/manual release checks before changing any
      status page from "planned."

Do not add a standalone package manifest merely to populate this folder; the
first implementation should reuse the extension or Android client unless a
real ChromeOS-specific runtime requirement emerges.
