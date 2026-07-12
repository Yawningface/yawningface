# Style Guide

Extracted from the iPhone app that cracked Screen Time blocking (the
`blocker_last_push` "OLD GOOD UI", January 2026) - now the design language for
**every** surface: iPhone, desktop tray, extension, web, CLI output. Taste is
99% of this product; when in doubt, this document wins.

## Mood

Calm, dark, confident. A blocker should feel like a quiet room, not a cockpit.
One accent color, generous emptiness, one emoji doing the emotional work.

## Tokens

### Color

| Token | Value | Used for |
| --- | --- | --- |
| `bg` | `#111926` | app background (deep navy, almost black) |
| `card` | `#1F2937` | cards, secondary buttons, inactive elements |
| `accent` | `#FACC16` | **yawn yellow** - icons, active tab, links, highlights |
| `text` | `#FFFFFF` | primary text |
| `text-70` / `text-60` / `text-50` / `text-30` | white @ 70/60/50/30% | secondary text ladder - pick the lowest level that still reads |
| `danger` | red @ 80% | destructive/give-up actions only |

Dark is the *only* theme for now - the product's home is the evening. A light
theme is a future decision, not a default.

**Contrast rule:** text on `accent` yellow is always **black**, never white.
(The old permission banner used yellow-on-white chips - that was a bug, not a
pattern.)

### Type

System font, always (SF on Apple, Segoe on Windows, system-ui on web).

| Role | Spec |
| --- | --- |
| Hero emoji | 100pt (state), 60pt (empty states) |
| Hero number (timers, counters) | 60–80pt bold |
| App name / page title | 36pt bold / `.title2` bold |
| Section header | `.headline` |
| Body | `.body`, `text-60` |
| Secondary / captions | `.subheadline`, `text-50…70` |

### Shape & spacing

| Element | Spec |
| --- | --- |
| Primary button | full-width pill: height 50, radius 25, **white bg, black bold text**; disabled = `card` bg + `text-50` |
| Accent CTA (small) | yellow pill, radius 20, black text, padding 12×24 |
| Card | `card` bg, radius 10–12, padding 16 |
| List/secondary button | `card` bg, radius 8, min-height 44 |
| Screen padding | 16–20 horizontal; content breathes - one idea per screen |

### Motion

Press feedback: scale to **0.95**, ease-out, **150ms** - on everything
tappable. Page transitions: plain ease-in-out. Nothing bounces, nothing
parallaxes. Calm.

## The emoji is the brand

State lives in one big emoji, center screen:

- 😴 idle - nothing blocked, the world is boring, as it should be
- 😎 blocking active - you're protected and a little cool about it

Empty states get a 60pt emoji + headline + one `text-60` sentence + at most
one yellow CTA. No illustrations, no mascots, no confetti.

## Voice

Second person, short sentences, zero guilt. We state trade-offs and respect
the reader; we never moralize, never mention "willpower", never celebrate
with badges.

| Situation | Say | Never say |
| --- | --- | --- |
| Welcome | "Take back your focus." | "Ready to crush your goals?!" |
| Explaining | "Block distracting apps during the times that matter most to you." | feature-listing paragraphs |
| Permission needed | "Permission needed to block apps!" + a Grant chip | scary system-speak |
| Bypass moment | "Is this really what you want?" · "Breathe. Think about why you started." | "You failed." |
| The exit | Always visible: **"Stay Strong"** in yellow | trapping the user |

The bypass flow ("Moment of Weakness") is honest drama, not punishment:
progress dots turn red, taps and waits escalate (10 taps → 10s → 20 → 10s →
30 → 10s), and the final button says "If you insist… Give Up". The user can
*always* leave the flow - and *always* finish it. That duality **is** smart
friction; keep it in every port.

## CLI voice

`✓` and `✗` prefixes, lowercase sentences, one line per fact, no spinners, no
emoji soup. Errors always name the fix ("create one with \"yf init\""). The
terminal version of calm.

## Cross-platform starter (web/extension/desktop)

```css
:root {
  --bg: #111926;
  --card: #1F2937;
  --accent: #FACC16;
  --text: #FFFFFF;
  --radius-card: 12px;
  --radius-pill: 25px;
  --press-scale: 0.95;
  --press-ms: 150ms;
}
```
