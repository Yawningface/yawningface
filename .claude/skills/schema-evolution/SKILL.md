---
name: schema-evolution
description: Use whenever changing packages/schema, adding config fields, or wiring a client to the contract. The yawningface-v2 schema-drift disaster is the reason this checklist exists.
---

# Evolving the cross-device contract safely

**Prime directive:** a client either speaks `packages/schema` or it doesn't
merge. v2 died because four clients parsed four dialects of "the same"
document (the extension expected `targets` as an array with `"Mon"`/`"AllDays"`
while everyone else used `targets:{websites,apps}` with `"mon"`).

## Checklist for any contract change

1. **Additive first.** New OPTIONAL fields; unknown fields are preserved
   round-trip by design. Bump `version` only for breaking shape changes, and
   only with a migration plan for configs already stored in the cloud.
2. Update in this order, in one PR:
   - `packages/schema/src/index.ts` (types + strict validator + evaluation)
   - `packages/schema/schema.json`
   - `packages/schema/fixtures/` (add a fixture exercising the new field)
   - `packages/schema/test/schema.test.mjs`
   - `packages/schema/README.md`
3. **Keep the two validation tiers straight:** `validateConfig` (minimal)
   must stay byte-compatible with the cloud's PUT check — it is deliberately
   lenient. Strictness goes in `validateConfigStrict` (producers only).
4. **Evaluation semantics are locked by Rust parity.** If you change
   `evaluateAt`, change `apps/desktop/src-tauri/src/schedule.rs` and BOTH
   test suites in the same PR (the TS tests mirror the Rust tests
   one-to-one: inclusive start, exclusive end, `start==end` whole day,
   midnight wrap, malformed times fail CLOSED toward blocking, day prefix
   matching, missing devices = everywhere).
5. **Update every consumer or file the gap** in `docs/ROADMAP.md` before
   merging. Consumers table lives in `packages/schema/README.md`.
6. Run `npm test` at the root (schema + CLI suites must stay green).

## Semantics quick-reference

Start inclusive, end exclusive; `start == end` = whole day; end < start =
crosses midnight (active when `t >= start || t < end` on each scheduled day);
empty `schedule` = every day; no `timePeriods` = always active while enabled;
missing `devices` = everywhere; malformed times = fail closed (block);
websites are bare domains, normalized like the Rust `normalize_domain`
(strip scheme/path/`www.`, lowercase; reject non-domains to empty string).
