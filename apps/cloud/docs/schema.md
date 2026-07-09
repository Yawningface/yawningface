# Blocklist config schema (v1)

This is the **cross-device contract** of YawningFace Block. Every client —
the desktop apps (Tauri), the Chrome extension, and the iPhone app — reads
and writes this exact JSON shape through `GET`/`PUT /api/v1/config`. The
cloud stores it verbatim (one document per user, last write wins) and never
interprets it; **all schedule evaluation happens on the clients**.

TypeScript types are exported from [`lib/schema.ts`](../lib/schema.ts).

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
          { "startTime": "09:00", "endTime": "13:00", "schedule": ["mon","tue","wed","thu","fri"] }
        ]
      },
      "targets": { "websites": ["twitter.com", "linkedin.com"], "apps": ["Discord", "Steam"] },
      "exceptions": []
    }
  ]
}
```

## Top level

| Field        | Type          | Notes                                   |
| ------------ | ------------- | --------------------------------------- |
| `version`    | number        | Schema version. Always `1` for now.     |
| `blocklists` | `Blocklist[]` | Zero or more blocklists.                |

## `Blocklist`

| Field        | Type               | Notes                                                    |
| ------------ | ------------------ | -------------------------------------------------------- |
| `id`         | string             | Stable slug-like identifier, unique within the config.   |
| `name`       | string             | Human-readable name shown in client UIs.                 |
| `metadata`   | `BlocklistMetadata`| Enforcement settings (below).                            |
| `targets`    | `BlocklistTargets` | What to block (below).                                   |
| `exceptions` | array              | Reserved for v2 (temporary allowances). Always `[]`.     |

## `BlocklistMetadata`

| Field         | Type           | Notes                                                                  |
| ------------- | -------------- | ---------------------------------------------------------------------- |
| `enabled`     | boolean        | Master switch. Disabled blocklists are never enforced.                 |
| `severity`    | string         | `"block"` (hard block). Clients may also support `"warn"`.             |
| `devices`     | string[]       | Any of `"desktop"`, `"mobile"`, `"tablet"`. A client only enforces blocklists that include its own category. |
| `timeZone`    | string?        | IANA zone name. **Informational in v1** — see schedule semantics.      |
| `timePeriods` | `TimePeriod[]?`| Active windows. **Empty or missing = always active while enabled.**    |

## `TimePeriod`

| Field       | Type     | Notes                                                        |
| ----------- | -------- | ------------------------------------------------------------ |
| `startTime` | string   | 24h `"HH:MM"`, inclusive.                                     |
| `endTime`   | string   | 24h `"HH:MM"`, exclusive.                                     |
| `schedule`  | string[] | Three-letter lowercase day codes: `"mon"`, `"tue"`, `"wed"`, `"thu"`, `"fri"`, `"sat"`, `"sun"`. |

### Schedule semantics (v1)

- Clients evaluate `timePeriods` **locally, in the device's own local time**.
  The `timeZone` field is informational in v1 (a future version may use it to
  pin schedules to one zone while travelling).
- A blocklist is active when `enabled` is `true` AND (it has no
  `timePeriods` OR the current local day/time falls inside at least one
  period).

## `BlocklistTargets`

| Field      | Type     | Notes                                                            |
| ---------- | -------- | ----------------------------------------------------------------- |
| `websites` | string[] | Bare domains (e.g. `"twitter.com"`). Clients should match subdomains too. |
| `apps`     | string[] | Application names as reported by the OS (e.g. `"Discord"`, `"Steam"`). Meaningful for desktop/mobile clients; the extension ignores them. |

## Server-side validation

`PUT /api/v1/config` performs **minimal structural validation** only
(`version === 1`, `blocklists` is an array, each entry has non-empty string
`id`/`name` and object `metadata`/`targets`). Clients are responsible for
producing well-formed documents; unknown fields are preserved round-trip.
