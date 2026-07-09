---
name: product-principles
description: Use when designing any feature, writing any user-facing copy, evaluating scope ("should we build X?"), or when the session starts drifting toward side-projects. This is the constitution as a review checklist.
---

# Product principles — the review checklist

Full text in `VISION.md`. Before building or merging anything, walk this:

## Scope gate (the sprawl killer)

**Does it reduce unwanted screen time?** If no → it does not merge, no matter
how fun. Pomodoro timers, lofi players, widgets — that sprawl killed the 2025
run in four days (side repos created 2025-02-26; blocker's last commit
2025-03-02). Shipped side-products live in their own repos, not here.

## Feature gates

1. **Sustainability test:** picture the user's worst legitimate moment (gym
   Instagram-add, vacation breakfast). Does the feature bend there, or does
   it teach them to uninstall? One bad moment costs the whole war.
2. **Smart-friction test:** is there always a legitimate way out, and does
   abuse make that way progressively harder (steps, waits, questions)?
   Both halves are mandatory — a wall with no door fails, a door with no
   friction fails. The iPhone "Moment of Weakness" flow is the reference.
3. **Sovereignty test:** AI proposes, the user applies. The config stays a
   JSON file the user owns and can edit by hand offline. Any feature that
   only works with AI, an account, or a server connection fails (offline
   basics are non-negotiable — Brick's internet dependency is its most-hated
   flaw).
4. **Contract test:** does it speak `packages/schema`? (See
   [[schema-evolution]].)
5. **Taste test:** dark navy, yawn yellow `#FACC16`, one emoji doing the
   emotional work, copy with zero guilt ("Stay Strong", never "You failed").
   Check `docs/STYLE_GUIDE.md`. No dark patterns — we don't fight
   manipulation with manipulation, even for the user's "own good".

## Voice quick-check for any copy

Second person, short, no moralizing, no "willpower", no badges/confetti, no
exclamation-mark enthusiasm. State the trade-off, offer the action, respect
the reader.
