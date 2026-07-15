# Yawningface browser companion specification

Status: implemented in extension v0.1.3 and desktop v0.2.16
Targets: Chrome and Microsoft Edge desktop, Manifest V3

## Product boundary

| Layer | Owns |
| --- | --- |
| Desktop | Sessions, schedules, active targets, hosts enforcement, exception policy, durable Insights |
| Extension | Pre-DNS browser redirect, blocked UI, browser attempt detection |
| Native bridge | Local state reflection, durable events, reason-gated exception requests |

The extension is a slave/companion of desktop. It has no independent session,
schedule, account, or blocklist configuration. Desktop blocking must remain
effective if the extension is absent; the browser experience becomes a DNS
error in that degraded case.

## Required behavior

1. Desktop writes a snapshot of normalized active domains after each engine
   evaluation.
2. The extension reads that snapshot over Native Messaging and replaces its
   complete dynamic DNR ruleset.
3. Each rule matches the domain and its subdomains for top-level HTTP/HTTPS
   navigation and redirects to packaged `blocked.html` before DNS.
4. Loading the blocked page queues a unique, durable `site_blocked` event.
5. Desktop deduplicates event IDs and updates both daily totals and per-domain
   Insights counts.
6. **Unblock anyway** first reveals a required, maximum-500-character reason.
7. Desktop approves an exception only when that normalized domain is in its
   current active snapshot. Desktop time, not browser time, defines a fixed
   ten-minute expiry.
8. Desktop removes the domain from hosts enforcement before acknowledging the
   request. The extension then removes its DNR rule and retries navigation.
9. Desktop records the approved domain, reason, duration, and time in Insights.
10. Expiry receipts are re-evaluated by desktop; an otherwise-active target is
    blocked again automatically.

## Native Messaging protocol

Host name: `com.yawningface.desktop`

Protocol version: `1`
Transport: Chromium length-prefixed JSON over stdin/stdout

### `get_state`

Request:

```json
{ "protocolVersion": 1, "type": "get_state" }
```

Response state fields:

- `available`
- `domains[]`
- `reasons[]`
- `sessionUntil`
- `focusedTodaySeconds`
- `unblocksToday`
- `updatedAt`

The service worker keeps one port open and polls this state every two seconds.
A 30-second alarm is the recovery path after worker suspension or disconnect.

### `site_blocked`

```json
{
  "protocolVersion": 1,
  "eventId": "uuid",
  "type": "site_blocked",
  "domain": "linkedin.com",
  "occurredAt": "RFC3339"
}
```

The extension queues locally before delivery. Desktop spools atomically before
acknowledging, and its stats store deduplicates `eventId`.

### `unblock_request`

```json
{
  "protocolVersion": 1,
  "eventId": "uuid",
  "type": "unblock_request",
  "domain": "linkedin.com",
  "reason": "Reply to a recruiter",
  "occurredAt": "RFC3339"
}
```

Successful response:

```json
{
  "ok": true,
  "eventId": "uuid",
  "minutes": 10,
  "until": "RFC3339"
}
```

The request fails closed if desktop is unavailable, the domain is not active,
the reason is empty/too long, or the privileged hosts helper cannot apply the
exception.

## Failure behavior

- Desktop disconnected: keep the last known DNR rules; show disconnected UI;
  no temporary exception can be issued.
- Event delivery interrupted: retain the local queue and retry.
- Invalid native origin or message: reject without mutating state.
- Hosts helper timeout: keep the browser rule and report the error on the
  blocked page.
- Extension missing: desktop hosts enforcement remains active, though Chrome
  may display its native DNS error.

## Privacy and permissions

Permissions are limited to `storage`, `alarms`, `declarativeNetRequest`, and
`nativeMessaging`, plus HTTP/HTTPS host access required for redirect rules.
There are no content scripts and no `tabs`, `history`, or `identity`
permissions. Only normalized domains and explicit reasons are recorded.

## Distribution

The immediate channel is an official GitHub Release ZIP containing the built
`dist` directory plus SHA-256 checksums. Users extract it and select **Load
unpacked**. Browser-store packaging can later add review, automatic updates,
and ordinary installation without changing the companion architecture.
