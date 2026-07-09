# @yawningface/cli — `yf`

Talk to your blocker. The config is one JSON file you own
(`./yawningface.json` by default); `yf` creates it, inspects it, checks it,
and — **only if you opt in** — reshapes it by conversation.

```
$ yf init --template stress-free-mornings
✓ wrote yawningface.json (Stress-free mornings)

$ yf show
● Stress-free mornings (stress-free-mornings)
    block on desktop, mobile, tablet
    Every day 06:00–12:00
    websites: facebook.com, instagram.com, x.com, twitter.com, ...
Right now (thu 09:12):
  desktop  blocking 11 domain(s), 0 app(s) via Stress-free mornings
```

## The coach (opt-in AI)

```
$ yf coach
you › I'm on vacation next week — mornings feel oppressive, but keep my nights strict
```

The coach's job is not to guard a single unlock — it edits the durable rules,
under a constitution: **sustainable beats radical, no guilt, smallest change
that solves it, the user is sovereign.** Every proposal is validated against
the [contract](../../packages/schema/README.md), shown as a diff, and applied
only after you confirm.

It needs a key for any OpenAI-compatible endpoint — and the default model is
**free**: a $0 key from [openrouter.ai](https://openrouter.ai/) is enough.

```
YF_COACH_API_KEY=...                                     # required (env or .env)
YF_COACH_BASE_URL=https://openrouter.ai/api/v1           # default
YF_COACH_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free    # default ($0)
```

Free models get congested at peak times; the client retries 429s politely,
and `YF_COACH_MODEL` switches models without touching code.

No key, no AI, no problem: `yf init` + editing the JSON by hand covers
everything, offline, forever. One-shot mode for scripts and agents:
`yf coach --once "block reddit on weekdays too" --apply`.

## Develop

```
npm run build   # tsc
npm test        # build + node --test
```

Runtime dependencies: none (Node ≥ 20). The only workspace dependency is
`@yawningface/schema` — the same contract every client enforces.
