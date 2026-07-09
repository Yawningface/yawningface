# @yawningface/schema

The **cross-device contract**. One JSON document per user describes everything
that should be blocked, where, and when. The cloud stores it verbatim (one
document per user, last write wins) and never interprets it; **every client
evaluates it locally**. This package is the single source of truth for the
document's shape *and* for the evaluation semantics.

If you change anything here, read [Evolving the contract](#evolving-the-contract) first.

## Example

```json
{
  "version": 1,
  "blocklists": [
    {
      "id": "morning-focus",
      "name": "Morning Focus",
      "metadata": {
        "enabled": true,
        "severity": "block",
        "devices": ["desktop", "mobile", "tablet"],
        "timeZone": "Europe/Madrid",
        "timePeriods": [
          { "startTime": "09:00", "endTime": "13:00", "schedule": ["mon", "tue", "wed", "thu", "fri"] }
        ]
      },
      "targets": { "websites": ["twitter.com", "youtube.com"], "apps": ["Discord"] },
      "exceptions": []
    }
  ]
}
```

## Semantics (v1)

- A blocklist is enforced when `enabled` is `true`, the evaluating device's
  kind is in `devices` (a missing `devices` field means *everywhere*), and the
  current local day/time falls inside at least one `timePeriod` (no periods =
  always active).
- Clients evaluate `timePeriods` **in the device's own local time**.
  `timeZone` is informational in v1.
- `startTime` is inclusive, `endTime` exclusive. `startTime === endTime`
  means the whole day. An end before the start crosses midnight
  (`22:00 → 07:00` blocks late evening and early morning on each scheduled day).
- Malformed times **fail closed towards blocking** — a broken document should
  never silently unblock anything.
- Websites are bare domains; clients match subdomains too and normalize
  input like `https://www.Twitter.com/foo` → `twitter.com`.
- Unknown fields must be preserved round-trip (forward compatibility).
- `exceptions` is reserved for contract v2: temporary allowances with a
  reason, the substrate of [smart friction](../../VISION.md).

## Two validation tiers

| Function | Who uses it | Behaviour |
| --- | --- | --- |
| `validateConfig` | the cloud, on `PUT /api/v1/config` | minimal, lenient — old servers must never reject newer well-formed documents |
| `validateConfigStrict` | producers: CLI, coach, client UIs | full structural validation of the canonical form |

`schema.json` is the same strict shape as a formal JSON Schema (2020-12), for
non-TypeScript consumers and codegen.

## Evaluation

`evaluate(config, device, now?)` returns the `BlockSet` (domains, apps, active
list names) the device must enforce at that moment. `evaluateAt(config,
minutesSinceMidnight, dayKey, device)` is the pure core. The behaviour is
locked by tests that mirror the Rust engine's tests one-to-one.

## Consumers — keep in sync

| Consumer | Where | Status |
| --- | --- | --- |
| Cloud API | `apps/cloud/lib/schema.ts` | duplicate of the types + minimal validator — collapse into this package (Phase 1) |
| Desktop engine | `apps/desktop/src-tauri/src/schedule.rs` | Rust re-implementation — parity locked by mirrored tests |
| iPhone app | `apps/iphone/YawningFace/Models.swift` | pre-contract local models — adopt contract during cloud-sync work (Phase 1) |
| Extension | `apps/extension/` | to be built against this package from day one |
| CLI & coach | `apps/cli` | imports this package directly |

## Evolving the contract

1. Design the change as **additive** (new optional fields) whenever possible.
2. Update, in this order: `src/index.ts` types → `schema.json` →
   `fixtures/` → `test/` → this README.
3. Update every consumer in the table above, or file the gap in
   `docs/ROADMAP.md` before merging. The extension schema-drift disaster of
   `yawningface-v2` is the cautionary tale: two clients silently parsing two
   different shapes of "the same" document.
4. Only bump `version` for breaking shape changes, and only with a migration
   plan for documents already stored in the cloud.
