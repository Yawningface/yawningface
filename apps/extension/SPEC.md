# Yawningface browser extension specification

Status: proposed implementation and distribution contract
Target browsers: Google Chrome and Microsoft Edge on desktop
Extension platform: Manifest V3

## Decision

Yawningface needs a browser extension, but it does not need a new extension
codebase. **apps/extension** already provides most of the standalone product:

- Manifest V3 service worker
- dynamic declarativeNetRequest rules
- top-level navigation redirects to a custom blocked page
- local per-domain attempt counts
- working sessions, schedules, and yawningface.json import/export
- optional account login and event upload

The missing piece is a trusted bridge between the extension and the installed
desktop app. Without it, a session started in desktop can be enforced by the
hosts file while the extension knows nothing about it. Chrome then shows a
network error instead of the yawningface page, and desktop Insights never
receives the extension attempt count.

The product therefore ships in two phases:

1. **Standalone extension:** blocks from extension-local configuration and
   shows its own block page. This is already substantially implemented.
2. **Desktop companion mode:** reads the active desktop block state and reports
   blocked navigation attempts to desktop Insights through Native Messaging.

## Product boundary

| Layer | Responsibility |
| --- | --- |
| Desktop engine | System-wide enforcement, native app termination, schedules, working-session ownership, durable local Insights |
| Browser extension | Browser-aware redirect, custom block page, blocked-domain attempt detection, toolbar controls |
| Native bridge | Transfers only the active block state and blocked-navigation events between those layers |

The hosts blocker remains active if the extension is absent, disabled, or
broken. The extension improves the browser experience; it must not become the
only enforcement layer on a computer with the desktop app.

## Goals

The first public build must:

1. Block top-level HTTP and HTTPS navigation to an active domain and all its
   subdomains.
2. Redirect before the network request to a local yawningface page.
3. Show the normalized domain, blocking reason, and end time when known.
4. Count exactly one attempt for each blocked top-level navigation.
5. Store attempt data locally by default.
6. Use the same schedule and blocklist schema as desktop.
7. Work in Chrome and Edge from one build.
8. Continue blocking offline and when the desktop bridge is unavailable.
9. Import and export yawningface.json.
10. Ship immediately as a GitHub Release ZIP for manual Load unpacked
    installation.

Companion mode must additionally:

1. Reflect desktop-started and desktop-ended sessions without an account.
2. Reflect desktop schedule changes.
3. Send normalized blocked-domain attempts to desktop Insights.
4. Reconnect after service-worker suspension or desktop restarts.

## Non-goals for the first public build

- Blocking subresources, ads, trackers, or page elements
- Reading page content, titles, form data, query strings, or browsing history
- Injecting content scripts
- Mobile browser support
- Remote configuration as a requirement
- Full-URL or keyword blocking
- A browser-specific schedule schema
- Silent installation on unmanaged Windows or macOS computers

## Current implementation audit

### Already present

- **src/engine.ts** evaluates the canonical schema and creates DNR rules.
- **src/blocked.html** and **src/blocked.ts** implement the custom page.
- **src/background.ts** records site_blocked events and local domain counts.
- **src/popup.ts** implements timed and unlimited working sessions.
- **src/options.ts** implements schedules plus JSON import/export.
- **src/cloud.ts** can queue and upload events after optional sign-in.
- **build.mjs** produces a self-contained unpacked extension in **dist**.
- The manifest includes a stable development key and branded icons.

### Release blockers

| Priority | Gap | Required resolution |
| --- | --- | --- |
| P0 | Desktop and extension are independent | Implement the native bridge below |
| P0 | Extension identity is inconsistent | Choose canonical IDs and support migration |
| P0 | The blocked page uses id=reason twice | Give the label and textarea unique IDs; add a regression test |
| P0 | Desktop Insights has no website-attempt model | Add normalized website counts and events |
| P0 | The test script points to a test directory that does not exist | Add engine, rule, block-page, and manifest tests |
| P1 | The manifest requests unused tabs permission | Remove it |
| P1 | Host access uses all_urls although rules only cover HTTP/S | Narrow it to explicit HTTP and HTTPS patterns |
| P1 | No GitHub extension release workflow exists | Add the workflow and ZIP contract below |
| P1 | No published privacy policy or Store disclosure package exists | Add both before Store submission |
| P1 | GitHub builds have no update UX | Show the installed version and link to update instructions |

## Blocking behavior

### Effective domain set

Use the union of:

1. enabled extension-local schedules;
2. an extension-local working session;
3. cached cloud configuration after explicit sign-in; and
4. active desktop domains received from the native bridge.

A temporary unblock removes only that normalized domain from the union. It
does not disable or mutate its source schedule.

### DNR requirements

- Use dynamic Manifest V3 declarativeNetRequest rules.
- Match HTTP and HTTPS, the exact domain, and all subdomains.
- Match only main_frame.
- Redirect to extension-owned blocked.html.
- Never match a domain that only contains the blocked domain. For example,
  notx.com must not match x.com.
- Normalize and deduplicate before assigning deterministic rule IDs.
- Replace the previous dynamic set atomically.
- Enforce the browser dynamic-rule limit and show an actionable error rather
  than silently dropping domains.

### Custom blocked page

Required content:

- yawningface artwork and branding;
- normalized blocked domain;
- source such as Working session or a schedule name;
- end time when known;
- local attempt count for this domain;
- focused time today;
- a primary action that leaves the blocked destination.

Unblock anyway is optional for the initial public build. If retained, it must:

- require an explicit reason;
- last a fixed short duration;
- record normalized domain, timestamp, duration, and reason;
- never expose the reason to a third party;
- pass keyboard and screen-reader testing; and
- include a regression test for the current duplicated DOM ID.

## Desktop companion bridge

### Technology

Use Chrome Native Messaging with host name:

    org.yawningface.desktop

The extension declares **nativeMessaging**. The desktop installer installs:

1. a small stdio native-host executable;
2. a native-host manifest with explicit allowed_origins; and
3. Chrome and Edge registration entries.

Do not reuse the Tauri UI executable unless it can enter host mode before Tauri
initializes and guarantee that stdout contains only framed protocol messages.
A small dedicated sidecar is safer.

### Desktop state handoff

The desktop engine writes an atomic state file whenever its effective block set
changes. Its version 1 shape is:

    {
      "protocolVersion": 1,
      "revision": 42,
      "generatedAt": "2026-07-15T15:30:00Z",
      "domains": ["linkedin.com", "x.com"],
      "activeLists": ["Working session"],
      "sessionUntil": "2026-07-15T16:00:00Z"
    }

The native host watches the file and emits a blockState message whenever the
revision changes. The extension opens a long-lived native port on installation,
browser startup, and service-worker startup. It reconnects with bounded
exponential backoff. A periodic alarm performs a fallback state check.

Every native message is schema-validated. Domains are normalized again before
entering DNR. Unknown protocol versions fail safely.

### Protocol

Extension to host:

    { "type": "hello", "protocolVersion": 1, "extensionVersion": "0.1.1" }
    { "type": "getBlockState" }
    { "type": "recordBlockedAttempt", "domain": "linkedin.com", "occurredAt": "2026-07-15T15:31:10Z" }
    { "type": "recordUnblock", "domain": "linkedin.com", "occurredAt": "2026-07-15T15:32:00Z", "minutes": 5 }

Host to extension:

    { "type": "helloAck", "protocolVersion": 1 }
    { "type": "blockState", "revision": 42, "domains": ["linkedin.com"], "activeLists": ["Working session"], "sessionUntil": "2026-07-15T16:00:00Z" }
    { "type": "ack", "requestType": "recordBlockedAttempt" }
    { "type": "error", "code": "invalid_domain" }

### Attempt ingestion

The native host must not write directly into a stats JSON file that desktop may
be writing simultaneously. Use a durable event spool:

1. validate and normalize the domain;
2. write one bounded event file atomically into a desktop-owned browser-events
   directory;
3. have the desktop engine drain those files into local Insights; and
4. delete a file only after its event is durably recorded.

An attempt contains only:

- normalized domain;
- UTC timestamp;
- browser family when available;
- active list names or session source when available.

It never contains a full URL, path, query, page title, or page content.

### Desktop Insights

Add a separate card titled **Websites you tried to open**. Do not mix website
attempts into **Apps that kept trying**.

Each row shows domain, count for the selected Insights period, and most recent
attempt time. The empty state explains that website attempts require the
extension. The Devices page links to installation instructions when missing.

## Data and privacy

- Local-only is the default.
- Blocked-domain attempts are browsing activity and are user data.
- Record only normalized blocked domains; record nothing for allowed visits.
- Keep local state in chrome.storage.local.
- Recommended retention: detailed events for 120 days; aggregate counts until
  the user clears Insights.
- Provide a Clear browser history data action in extension options.
- Cloud upload is opt-in through sign-in.
- Cloud upload of domains must be disclosed in the UI, privacy policy, and
  Chrome Web Store privacy form.
- Include all executable logic in the package; load no remote code.

## Manifest and permissions

| Permission | Reason |
| --- | --- |
| storage | configuration, session state, attempt counts, event queue |
| alarms | schedule evaluation, expiry, reconnect fallback |
| declarativeNetRequest | private browser-side blocking and redirect rules |
| nativeMessaging | optional connection to installed yawningface desktop |
| identity | only if optional account login ships in this build |
| HTTP and HTTPS host access | user-defined domains can be any web host |

Remove **tabs**; the current source does not call chrome.tabs.
Replace the current all_urls match with explicit http://*/* and https://*/*
patterns in host permissions and web-accessible-resource matches.

The Store listing must explain broad host access plainly: it is used only to
redirect top-level navigation for domains the user chose to block. The
extension does not read page contents or observe allowed browsing.

For a smaller first Store review, account login and **identity** may be
deferred. The single purpose remains: block user-selected distracting websites
and show a local yawningface page.

## Extension identity

Identity must be resolved before public release. The repository currently has:

- manifest-key development ID **pbpgbdnamekjeifocnifopkecnphchjb**;
- desktop scanner and install-link ID
  **kfnhibndbkdjcplihjhbhdhclpbiocen**, from the old listing.

Preferred migration:

1. Determine whether Yawningface controls the old Chrome Web Store listing.
2. If yes, evaluate updating that listing with the MV3 build so existing users
   and its ID are preserved.
3. During migration, desktop detection and native-host allowed_origins support
   both IDs.
4. Register every shipped ID as an Auth0 callback before enabling sign-in.
5. If the listing cannot be reused, create a new listing and update desktop
   detection, links, host manifests, and callbacks together.

The GitHub unpacked build retains a stable manifest key so updates preserve its
identity and local data.

## Distribution strategy

### Track A: GitHub Releases now

GitHub is an early-adopter channel, not a substitute for normal Chrome
installation.

Publish:

- **yawningface-extension-vX.Y.Z-unpacked.zip**
- **SHA256SUMS.txt**
- release notes containing Chrome and Edge install/update instructions

The ZIP contains manifest.json at its root. It contains no source maps, source
files, environment files, secrets, or parent dist directory.

Do not advertise a GitHub-hosted CRX as a normal Windows/macOS installation.
Chrome permits Load unpacked for trusted local development, but direct
installation and automatic updates on unmanaged Windows/macOS require the
Chrome Web Store. Self-hosting is otherwise an enterprise-managed mechanism.

#### Chrome installation

1. Download the unpacked ZIP from the GitHub Release.
2. Extract it to a permanent folder. Do not select the ZIP itself.
3. Open chrome://extensions.
4. Turn on Developer mode.
5. Click Load unpacked.
6. Select the folder that directly contains manifest.json.
7. Pin yawningface from the Extensions menu.
8. Import yawningface.json in options if needed.

#### Edge installation

1. Open edge://extensions.
2. Turn on Developer mode.
3. Click Load unpacked.
4. Select the same extracted folder.

#### Manual update

1. Download the newer ZIP.
2. Replace files in the same permanent folder.
3. Open the browser extensions page.
4. Click Reload on yawningface.
5. Confirm the displayed version changed.

Stable local data depends on the extension ID, not the folder path. Never
remove the pinned development key from GitHub builds.

### GitHub Actions contract

Add **.github/workflows/extension-release.yml**:

- trigger on extension-v tags and manual dispatch;
- use Node 22 and npm ci at repository root;
- run schema and extension tests;
- build the extension with public tenant variables;
- fail if package, manifest, and tag versions differ;
- verify all manifest assets exist;
- reject source maps and environment files;
- ZIP the contents of dist, not the directory itself;
- generate SHA-256 checksums;
- upload artifacts on manual runs;
- attach ZIP and checksum to GitHub Releases on tags.

### Track B: Chrome Web Store

The Store is the real general-user channel:

1. recover or create a dedicated organizational developer account;
2. pay the one-time registration fee;
3. resolve whether to reuse the old listing;
4. publish first to trusted testers or unlisted visibility;
5. upload the release ZIP;
6. complete permission justifications and privacy disclosures;
7. provide a public privacy policy;
8. provide accurate popup, block-page, options, and companion screenshots;
9. test upgrade and rollback;
10. move to public visibility after approval and tester validation.

Broad host access and blocked-domain events may receive extra review attention.
They are defensible because they are required by the prominently disclosed
blocking feature, but package scope and disclosures must remain narrow.

### Track C: Microsoft Edge Add-ons

Submit the same MV3 codebase to Edge Add-ons once stable. Keep the Edge listing
ID in native-host allowed_origins. Until approval, use the GitHub unpacked ZIP.

## Store listing

Single purpose:

> Block the distracting websites you choose and replace them with a local
> yawningface reminder.

Required assets:

- 128 px extension icon;
- at least one 1280 by 800 or 640 by 400 screenshot;
- popup screenshot;
- block-page screenshot;
- options/schedules screenshot;
- concise permission explanation;
- support URL;
- privacy-policy URL.

Do not claim that desktop Insights includes website attempts until the bridge
and desktop ingestion ship.

## Testing

Automated coverage:

- exact domain and subdomain matching;
- false-positive protection for containing domains;
- HTTP and HTTPS main-frame redirect;
- deterministic rule IDs and deduplication;
- dynamic-rule limit handling;
- overnight schedule parity with desktop;
- session start, expiry, and no-limit behavior;
- one attempt per block-page navigation;
- unblock expiry and reason validation if retained;
- malformed native-message rejection;
- disconnect and reconnect;
- durable, idempotent event-spool draining;
- manifest permission allowlist;
- every referenced dist asset exists;
- package, manifest, and tag version equality.

Manual release matrix:

- Chrome stable on Windows and macOS;
- Edge stable on Windows;
- clean install and upgrade from previous unpacked ZIP;
- desktop present, absent, running, and stopped;
- signed out, signed in, and offline;
- working session, schedule, and overlap;
- exact domain and subdomain;
- browser restart and service-worker suspension;
- keyboard-only and screen-reader block-page pass.

## Acceptance criteria

Ready for GitHub testing:

- all P0 blockers resolved;
- extension build and tests pass in CI;
- Release ZIP installs in clean Chrome and Edge profiles;
- desktop-started sessions produce the custom page within five seconds;
- visiting linkedin.com creates one linkedin.com attempt in desktop Insights;
- no allowed navigation is recorded;
- extension removal does not disable desktop enforcement;
- checksum and update instructions are published.

Ready for Chrome Web Store:

- production identity resolved;
- privacy policy and disclosures match actual behavior;
- only necessary permissions remain;
- Store assets and support links are complete;
- trusted-tester upgrade and uninstall tests pass.

## Official references

- [Chrome distribution](https://developer.chrome.com/docs/extensions/how-to/distribute)
- [Chrome Load unpacked](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)
- [Chrome alternative installation methods](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions)
- [Chrome declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
- [Chrome permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Chrome Web Store privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [Chrome Web Store review process](https://developer.chrome.com/docs/webstore/review-process)
- [Edge sideloading](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading)
- [Edge Native Messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/native-messaging)
