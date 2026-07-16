# The multi-device persona

**The user who knows blocking one device just moves the scrolling to another: phone, laptop, tablet — they want to press one button and have every screen they own go quiet at once.**

This is the persona [Freedom](https://freedom.to) built its business on ("One session. All devices. Zero distractions." — "Freedom is the only app that can sync blocking sessions across all your devices"). It is also the persona closest to our own vision (principle #4, "One brain, every device"), which makes Freedom our most direct competitor — and the one whose claim we have to beat *feature-for-feature*, not just on price or openness.

## Deconstructing Freedom's pitch

- **Session-first, not schedule-first.** Their three steps are: select devices → choose blocks → set session length. The hero moment is *starting a session and feeling it land everywhere*. Schedules are the follow-up habit (and paywalled).
- **Sessions fan out, configs don't just sync.** The load-bearing word is *session*: start on desktop, the phone blocks too, within seconds. Config sync alone (what most "cross-device" apps mean) does not deliver that moment.
- **Anti-gamification as positioning.** "No dopamine-triggering streaks, points, leaderboards, or rewards." They market *against* engagement mechanics. Note the partial tension with our principle #6 (social accountability) — our line holds because we frame it as "social, not gamified," but any streaks/leaderboard feature must be measured against this persona's taste.
- **Breadth as the header claim.** Mac, Windows, iOS, Android, Chromebook, Linux. The platform grid *is* the landing page.
- **The padding is skippable.** Focus sounds, Brain.fm tracks, pomodoro — exactly the productivity-suite sprawl our VISION lists as a permanent non-goal. This persona buys the sync, not the soundtrack.

## Where Freedom is weak (per docs/COMPETITORS.md)

- **It charges $39.99/yr for a schedule.** The free tier syncs blocklists, but scheduling and locked mode — the things that make a config a config — are paywalled. That's the attack line, not "it costs money."
- Closed source, not self-hostable, not extensible; the config is theirs, not yours.
- Android is its weakest client; app blocking depth varies by platform.
- Zero AI, no agent surface, no physical-world unlocks.

## Our honest platform grid today

| Platform | Freedom | YawningFace |
| --- | --- | --- |
| macOS | yes | shipped; Tough Mode is implemented for desktop v0.2.22 |
| Windows | yes | shipped |
| Browser extension | yes (session client) | shipped v1; contract rebuild pending |
| iPhone | yes | v0.1 local-only, sync pending (entitlement is the long pole) |
| Android | yes (weakest) | Phase 3 |
| Chromebook / Linux | yes | planned; design placeholders only |

We cannot say "every device" yet. The true, checkable claim (from COMPETITORS.md): **"the only open-source blocker that crosses the phone/desktop line"** — once iPhone sync ships. Until then, this persona is aspirational and the copy must not overpromise.

## What winning this persona requires

1. **Session fan-out, not just config sync** (Roadmap Phase 1: `yf session start 2h` + tray button → ephemeral block-everything everywhere). The bar is *seconds*, not the next poll: desktop/extension can poll fast or hold a socket; iPhone is the hard one (silent push is unreliable — likely needs APNs + a DeviceActivity always-armed fallback window). Latency is the product here.
2. **Schedules stay free, forever.** Freedom's paywall is our wedge; never gate the schedule.
3. **Pairing that feels like Apple** (Phase 2: desktop offers the extension, iPhone pairs via QR — "Freedom's flow, our taste"). For this persona, adding a device *is* the aha moment; it must take under a minute.
4. **Tough Mode that fans out.** The cross-device lock ledger (see tough-block persona) is the combined pitch neither Freedom nor Cold Turkey can make: *one session, all devices, and you can't back out on any of them.*

## Convergence with the other personas

All three personas we track meet at the same feature: sync. The privacy persona self-hosts it, the tough-block persona wants the lock to follow them, the multi-device persona wants sessions to land everywhere — and the upsell story (hosted sync as the paid convenience, capability never gated) monetizes it without breaking "free, open source, forever."

## Related

- Market scan: [docs/COMPETITORS.md](../docs/COMPETITORS.md) (Freedom rows + "what is defensibly ours")
- Open product questions: [docs/product-questions.md](../docs/product-questions.md)
- Tough-block persona: [tough-block-persona.md](tough-block-persona.md)
