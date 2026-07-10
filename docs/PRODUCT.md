# How we do product

VISION.md says why we exist and what we refuse to build. This doc says how we
decide **what to build next**. It exists because the 2025 run died of
unmanaged product — four side-projects born in one day, blocker dead four
days later — not of bad engineering.

## The user (beachhead)

The remote/indie worker with 4–8h daily screen time who has **already tried
blockers and uninstalled them** at the first legitimate exception (the gym
Instagram-add, the vacation breakfast). Xuban is user zero. We win this
person first; "everyone who scrolls" is the mission, not the market entry.

## The problem, sharply

Blockers die at the first legitimate exception — one bad moment costs the
whole war. **Sustainability is the product. Blocking is table stakes.**
Every feature must answer: does this make the blocker survivable for months?

## North star

**Devices still enforcing at least one block 28 days after install.**

Not stars (marketing proxy), not downloads (curiosity proxy). A blocker that
gets uninstalled is a failed blocker regardless of how it trended. The
`events` telemetry (heartbeats) is how we'll measure it, opt-in and honest.

## The bet stack (riskiest assumption first)

A bet = an assumption that might be wrong + the cheapest test of it.
Re-rank when evidence lands; kill bets without ceremony.

| # | Assumption at risk | Cheapest test | Status |
| --- | --- | --- | --- |
| 1 | *People will keep a bend-don't-break blocker installed* (retention) | Windows app, working sessions + helper, in 5–10 real users' hands for a month | *next — needs v0.2.1 published + repo public* |
| 2 | *Anyone will find it* (distribution) | Repo public + build-in-public thread + one Show HN / r/nosurf post; watch first 100 installs | queued behind bet 1 |
| 3 | *The coach measurably improves retention* (the differentiator) | Coach in the desktop app for the same cohort; compare uninstall/relax behaviour | after 1–2 |
| 4 | *One brain, every device* is the winning wedge (sync) | iPhone contract adoption + extension rebuild, same cohort | after 1–2 |
| 5 | *Physical tokens matter* (NFC) | Foqos-pattern tag unlock on iPhone; do users who set it up retain better? | later |

What is deliberately **not** a bet: whether we can build it (proven, Jan
2026), and anything in VISION.md's non-goals.

## The loop

1. Pick the top bet. Define the smallest shippable test.
2. Ship it (release train: tag → draft → publish; nothing sits unshipped).
3. Watch: telemetry for behaviour, issues/DMs for words.
4. Write down what we learned in this file (one line per bet outcome).
5. Re-rank. Repeat.

Weekly rhythm: something a user can *feel* ships every week, even if tiny.
Cadence beats intensity — consistency is the one superpower this project has
already proven it has (Jan 2025: 17 straight days built a product).

## Decision rules (the "no" machine)

- Serves the north star? If not, it's decoration — park it.
- Passes the [[product-principles]] gates (sustainability, smart friction,
  sovereignty, contract, taste)? If not, redesign or drop.
- Is it the top bet's smallest test? If it's bet 4 work while bet 1 is
  unproven, it waits — however fun it is.
- Distribution work counts as product work. Half of every week's shippable
  can be a screenshot thread, a README improvement, a store listing.

## Definition of done for "v1 in the wild" (bet 1's gate)

- [ ] Windows helper verified end-to-end on a real machine (one UAC approval)
- [ ] v0.2.1 draft published on GitHub Releases
- [ ] README shows real screenshots of the current UI
- [ ] Repo public
- [ ] 5+ people who are not Xuban running it
