# Architecture - one brain, many hands

```
                ┌─────────────────────────────┐
                │        apps/cloud           │
                │  Next.js + Supabase + Auth0 │
                │  stores ONE config doc/user │
                │  (verbatim, last-write-wins)│
                └──────────────┬──────────────┘
             GET/PUT /api/v1/config · POST events
        ┌──────────────┬───────┴───────┬──────────────┐
        ▼              ▼               ▼              ▼
  apps/desktop    apps/iphone     apps/extension   apps/cli (yf)
  Rust/Tauri      Swift/ScreenTime  MV3 (rebuild)  human & agent
  hosts file +    ManagedSettings   declarative-   surface + the
  app killer      shields           NetRequest     opt-in coach
        └──────────────┴───────┬───────┴──────────────┘
                               ▼
                    packages/schema - THE CONTRACT
              types · validation · evaluation semantics
```

## The rules that keep it sane

1. **The cloud never interprets the config.** It stores one JSON document per
   user, last write wins, and serves it back. All intelligence lives at the
   edges. This keeps the server tiny, self-hostable, and impossible to
   version-skew against clients.
2. **Every client evaluates locally, offline-first.** The desktop caches the
   last config and keeps enforcing through network loss; the iPhone monitor
   extension runs OS-side even when the app is killed. No internet
   dependency to block or unblock - [Brick's most-hated flaw](COMPETITORS.md)
   is our design constraint.
3. **The contract is law.** `packages/schema` is the single source of truth
   for shape *and* semantics (start inclusive, end exclusive, midnight
   crossing, fail-closed on malformed times…). The Rust engine's behaviour is
   locked to it by mirrored tests. The `yawningface-v2` attempt died of schema
   drift - four clients, four dialects; never again.

## Enforcement per platform

| Platform | Mechanism | Notes |
| --- | --- | --- |
| Windows/macOS | managed `/etc/hosts` section via a spool file + one-time privileged helper (LaunchDaemon / SYSTEM task); process killer for apps | no password prompts after install; DoH bypass documented |
| iPhone | FamilyControls selection → ManagedSettings shields applied by a DeviceActivity monitor extension | survives force-quit; requires the Family Controls entitlement + a physical device |
| Browser | `declarativeNetRequest` rules compiled from the contract (rebuild) | old tab-redirect engine is retired |
| Android (planned) | UsageStats polling + overlay (TapBlok pattern) - avoids accessibility-policy friction | Play-safe |

## Telemetry & the coach

Clients POST minimal events (block hits, session starts, heartbeats) to
`/api/v1/events`; `/api/v1/summary` aggregates the last 7 days. That feed is
what lets the coach answer "how did I do last week?" - and nothing else
consumes it. The coach itself is a thin client: current config + your words
in, a complete proposed config out, strict-validated, diffed, and applied
only on your yes. Any OpenAI-compatible endpoint works; no key, no AI, full
product.

## Where this is going (contract v2 - see ROADMAP)

- **`exceptions`** field (already reserved): temporary allowances with a
  written reason and expiry - the substrate of smart friction.
- **Working sessions**: an ephemeral "block everything now for 2h" that
  fans out to every device, no config edit involved.
- **Physical & spatial context**: NFC tag identities as unlock keys
  (same-tag-to-unlock, Foqos-style), geofence rules per blocklist.
- **Social**: opt-in screen-time sharing between friends.
