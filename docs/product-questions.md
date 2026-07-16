# Open product questions

Living doc of product/positioning issues to think through. Update as decisions get made.

## 1. Tough-block user persona (Cold Turkey persona)

The user who says "I don't trust myself — take the keys away." Reference competitor: Cold Turkey ("almost impossible to stop the block once you lock it").

See [product/tough-block-persona.md](../product/tough-block-persona.md) for the full persona + the macOS Tough Mode design.

Status:
- macOS Tough Mode shipped (root-held monotonic lock, self-healing hosts, no early exit).
- Extension still has an emergency unlock escape hatch — strict mode should disable it while a lock is active.
- Windows: not yet (SYSTEM task exists but no lock semantics).
- Roadmap hardening: helper refuses self-removal while locked, PF second layer (DoH hole),
  cloud lock ledger, server-signed emergency-unlock tokens.

## 2. Privacy user persona

The user we already serve: open source, self-hostable, no one else holding attention data.

- Keep this identity intact — it's the trust story that makes Tough Mode credible
  (Cold Turkey = opaque binary with SYSTEM rights; we = auditable lock).
- Watch for conflicts: hosted sync / paid tiers must not undermine "your data stays yours."

## 3. Upsell story

Constraint: serve existing users + both personas above, and still have something to sell.

Reference: Cold Turkey model = free version, 7-day trial, one-time purchase, "read my story" plea.
Verdict: keep some elements, reorder. "Why upgrade" must be a win-win value statement, not a sympathy ask.

Current premium candidate: **device synchronization** (hosted).

Notes / open sub-questions:
- Open-core fit: self-hosters can always sync via their own server (free, keeps promise);
  paid tier = *hosted* sync (convenience, we run the infra). Genuine win-win: recurring cost -> recurring value.
- Sync-gating is naturally freemium: free = single device / local-only / self-host;
  upsell moment = user tries to add a second device. May not need a classic timed trial at all.
- Cross-device lock ("a lock that follows you to every device") makes sync valuable to the
  tough-block persona too — the two personas converge on the paid feature.
- Trial duration: 7 days is short for a habit product; consider 14 days, or event-based
  ("free until second device") instead of time-based.
- Pricing model: one-time (Cold Turkey style) vs subscription — hosted sync has ongoing cost,
  leans subscription, but audience may prefer one-time. TBD.
- Safety rule: trial/subscription expiry must never silently weaken or delete blocks —
  devices keep enforcing their last-known config locally, forever.

## Technical learnings from SelfControl architecture report (GPL — ideas only, no code copying)

- Core principle: the enforcement daemon exposes NO "stop" verb. Block ends only when the
  daemon itself observes the end date passed. (Now implemented in our macOS applier.)
- Monotonic mutations while locked: add domains / extend end date only (we cap at 7 days).
- Self-healing: watch /etc/hosts + idempotent writes (implemented); periodic integrity run.
- Anti-permablock safety: corrupt/expired lock state is cleared cleanly, never left unbounded.
- Escape hatch: SelfControl's killer key (SHA-1 of serial+timestamp) is computable by anyone
  reading the source — broken for open source. Ours must be a *server-signed* unlock token
  verified with an embedded public key (also ties emergency reset to the hosted cloud tier).
- Code-signing pinning (Apple team ID) works fine for open source — attacker can read code
  but can't sign with our team ID.
- Phase 2: IP-level second layer (macOS PF anchor w/ reference-counted pfctl token; Windows
  needs WFP). Closes the DNS-over-HTTPS hole hosts blocking leaves open.
