# The market, mid-2026

Full sweep of what YawningFace is up against, platform by platform. Last verified
2026-07-13. Prices move fast in this category; re-check before quoting any of
this publicly.

## The headline: the triangle moved

The old version of this doc claimed three moats (cross-device sync / physical
unlock / open source) and said nobody held more than one. **That is no longer
true, and the corner we thought was ours is the one that got crowded.**

| Old claim | Reality, July 2026 |
| --- | --- |
| "Open source is held only by Foqos, and it's iPhone-only" | Open source + free + physical unlock is now held **three times over**: Foqos (iOS), Normal (iOS), Switchly (Android), plus Curbox (Android). It is the *default* in this niche, not a moat. |
| "Freedom is closed and paid" | Freedom has a **free tier** that syncs blocklists across unlimited devices on 5 platforms. Free + cross-device is no longer empty. |
| "Free is a differentiator" | ScreenZen is **100% free, no premium tier at all**, on iOS, Android, **macOS and Windows**. Cold Turkey and AppBlock also have real free tiers. |

**What is still genuinely empty.** Searched hard for a counter-example, found
none:

1. **One config, enforced natively on iPhone + Android + Mac + Windows + browser,
   free and open source.** A handful of products do span phone and desktop
   (Freedom, Focus Bear, BlockerX, FocusMe, Pluckeye, ScreenZen, and Opal on the
   Apple + Android side), and **every one of them is closed source**. Freedom is the only one whose *sessions genuinely fan out* to
   every device, and it paywalls the two things that make a config a config:
   scheduling and locked mode. Meanwhile every open-source blocker is stuck on
   exactly one platform. **Nobody in OSS crosses the phone/desktop line.** That
   intersection, cross-device *and* open, is the wedge, and it is empty.
2. **A conversational AI that rewrites a portable, user-owned config.** The
   closest anyone gets is FocusMe's AI Coach, which analyzes usage and applies
   plan recommendations one click at a time, inside its own closed plans. Real,
   and closer than the doormen (Zario, LOCKR), but it is not conversational, not
   cross-device, and the "config" is theirs, not yours.
3. **Agent-native.** FocusMe ships a CLI (start/stop/list plans, cron and Task
   Scheduler integration), so "not one competitor speaks a terminal" is false.
   What remains empty: an open config contract a terminal or an agent can *edit*,
   not just a remote control for opaque plans.
4. **A self-hostable hub.** Nobody.

The pitch is therefore no longer "free + open + physical". Foqos already is that.
The pitch is **"the only blocker that is one brain across your phone *and* your
computer, and doesn't charge you for the schedule."**

---

## iPhone

The most crowded platform by far, because Apple's Screen Time API (FamilyControls
/ DeviceActivity / ManagedSettings) made persistent blocking possible for
everyone at once.

| App | Price | Beyond iOS | Signature move |
| --- | --- | --- | --- |
| **Apple Screen Time** | free, built in | Apple only | the real default. Trivially bypassed ("Ignore Limit"), which is the reason this market exists |
| **Opal** | $99.99/yr, $19.99/mo, $399 lifetime | iPad, macOS, Chrome ext, **Android (since mid-2025, ~88K installs/mo, 4.2 stars)** | Deep Focus (genuinely unbypassable), focus score, friend leaderboards. Still no Windows |
| **Foqos** | **free, MIT** | iOS only | **the OSS benchmark.** 12 blocking strategies (NFC / QR / timer / hybrid), break allowances, streaks, Live Activities. 4.9 stars on 5000+ reviews, 588 GitHub stars, 108 forks, v2.1.0 shipped July 2026. Local only, no sync |
| **Normal** | **free, open source** | iOS only | any NFC tag or QR code (incl. AirTags), PBKDF2-hashed pairing, app groups, timed unlocks. Zero data collection, local only, no sync |
| **ScreenZen** | **100% free** (donations) | Android, **macOS, Windows** | per-open pause + intention prompts. No premium tier at all. Sells the Halo puck ($49). Free and on all four consumer platforms: the closest thing to our shape, just closed source |
| **one sec** | ~$4.99/mo, free = 1 app | Android | forced breathing pause. Peer-reviewed, -57% app opens |
| **AppBlock** | free tier; $29.99/yr, $89.99 lifetime | Android, Chrome/Edge/Brave | 15M+ users. **Location and WiFi-triggered blocking**, Strict Mode, profiles |
| **Jomo** | ~$4.99/mo, $29.99/yr | Apple only | NFC tags, templates, journaling, AI photo-proof unlock |
| **Roots** | $59.99/yr | iOS | Monk Mode, no overrides. "Digital dopamine" tracker |
| **Clearspace** | free = 1 app, $49.99/yr | iOS | pushups convert to screen minutes; accountability teammates |
| **BePresent** | freemium | Android | gamified "present sessions", friend competition, real-life rewards |
| **Freedom** | free tier; $39.99/yr | Mac/Win/Android/Chromebook/ext | the only true cross-device incumbent |
| **Forfeit** | stakes | Android | bet real money on staying under your limit |
| **Brick / Unpluq / Blok / Bloom** | hardware, see below | Android too | physical NFC unlock |
| **Zario / LOCKR** | subscription | iOS | AI doorman (see AI section) |

Long tail that exists but barely matters: Habit Doom, Refocus, MindBack, Habi,
ScreenBuddy, Unstar, Sip & Scroll, Blok, unhookd, Chronoid. Mostly one-person apps
whose real product is an SEO blog (see the distribution section at the bottom).

## Android

Structurally different: no Screen Time API, so everyone uses UsageStats polling
plus an overlay, or the Accessibility Service (which Google keeps threatening to
restrict). Blocking is weaker and more bypassable than on iOS, and the
open-source field is healthier.

| App | Price | Signature move |
| --- | --- | --- |
| **Google Digital Wellbeing** | free, built in | the default. Weak, easy to ignore |
| **AppBlock** (MobileSoft) | free tier; $29.99/yr | **the volume leader, 15M+ users.** Profiles, Strict Mode, location/WiFi triggers |
| **Switchly** | **free, open source** | the Android Foqos. NFC / QR / barcode, paired tags, Quick Settings tile, app + website + **in-app surface** blocking, daily limits. Foqos itself points Android users here |
| **Curbox** | **free, open source** (F-Droid) | successor to DigiPaws (discontinued). **Short-form blocker: kills Reels and Shorts inside the app**, granular UI hiding, no internet permission at all |
| **ScreenZen** | **100% free** | pauses and limits, same as iOS |
| **one sec** | freemium | breathing pause |
| **StayFree** | freemium | usage tracking plus limits, large install base |
| **Stay Focused** | freemium | strict mode, granular limits |
| **TimeLimit** | free, open source | F-Droid, parental-control shaped |
| **Minimalist Phone / Olauncher** | freemium / free OSS | launcher-level: remove the temptation surface entirely |
| **Forest** | paid | gamified trees. Habit, not enforcement |
| **Freedom** | free tier; $39.99/yr | cross-device, but Android is its weakest client |
| **FocusMe / Pluckeye / BlockerX** | see Windows | the rare desktop-plus-Android players |
| **Brick / Unpluq** | hardware | Brick added Android in Sept 2025 |

Prior art still worth reading before we write ours: TapBlok (Apache-2.0;
UsageStats polling plus overlay, avoids accessibility-policy friction), nfcGuard
(accessibility route).

## Chrome extension

Effectively a commodity. The browser is the easiest surface to block and the
hardest to monetise, so the best options here are free and old.

| Extension | Scale / price | Signature move |
| --- | --- | --- |
| **BlockSite** | ~5M+ users, freemium | the volume king. Polished, upsells to its mobile apps |
| **StayFocusd** | ~700k+ users, **free** | since 2011. Daily time allowance, then locked out. Chrome only |
| **LeechBlock NG** | **free, open source** | the power user's pick. Chrome/Firefox/Edge/Brave/Opera/Vivaldi. Rules like "Reddit 15 min per hour, Twitter never 9-5" |
| **Freedom** | with subscription | the extension is a *client of the cross-device session*. This is the model we are copying |
| **Cold Turkey** | with license | companion to the desktop app, same idea |
| **Opal** | with subscription | Chrome ext, tethered to the Mac app |
| **AppBlock** | with account | Chrome/Edge/Brave |
| **WasteNoTime / FocalFilter / Mindful Browsing / Strict Workflow** | free | older, simpler, still in use |
| **News Feed Eradicator / Unhook / DF Tube** | free | **surgical**: kill the feed, keep the site. Underrated model, same idea as Curbox |

**The strategic read:** a standalone extension is worthless as a product, because
the browser is exactly where blocking is easiest to route around (just open Edge).
An extension only earns its keep as **a client of a cross-device contract**, which
is precisely what `apps/extension` is being rebuilt as. Freedom and Cold Turkey
both understand this. Do not ship a standalone extension.

## macOS

| App | Price | Signature move |
| --- | --- | --- |
| **Cold Turkey** | **free tier**; Pro ~$39 one-time | the strict standard. Frozen Turkey locks the whole machine. One key covers every computer you own. **No mobile, ever** (they say so explicitly) |
| **SelfControl** | **free, GPL** | the original. Set a timer; the block survives a restart *and* deleting the app. Websites only, no app blocking, no sync. v4.0.2 |
| **Freedom** | free tier; $39.99/yr | cross-device sessions |
| **Opal** | $99.99/yr | Mac client; ecosystem is Apple + Android now, still no Windows |
| **ScreenZen** | **100% free** | Mac app (macOS 13+), same pause model as mobile |
| **Raycast Focus** | free (inside Raycast) | focus sessions that block apps and sites, browser integration. Ambient distribution: it rides an app people already have open |
| **1Focus** | paid, Mac App Store | Mac-native app and website blocker |
| **Focus** (heyfocus.com) | paid | scriptable, Pomodoro-integrated |
| **FocusMe** | $119.99 lifetime, or subscription | also Win/Linux/Android |
| **DigitalZen** | paid | Win/Mac/Linux plus extensions; blocks *unknown* browsers |
| **Apple Screen Time** | free | built in, bypassable |

## Windows

The strictest platform, and the one where a one-time purchase still wins.

| App | Price | Signature move |
| --- | --- | --- |
| **Cold Turkey** | **free tier**; Pro ~$39 one-time | **the one to beat on Windows.** Near-unbypassable. Frozen Turkey. Pay once, own forever. Desktop only |
| **Freedom** | free tier; $39.99/yr, $99.50 lifetime | the only incumbent that also covers the phone |
| **FocusMe** | $7.95-12.95/mo, $119.99 lifetime | Win/Mac/Linux/Android. Time *limiters* rather than hard walls |
| **DigitalZen** | paid | Win/Mac/Linux plus browser extensions. Blocks browsers it does not recognise |
| **Pluckeye** | free / donation | Win/Mac/Linux/Android. **Delay-based instead of passwords**: setting changes take effect later, never now |
| **BlockerX** | freemium | porn-blocking first, distraction second. Cross-platform |
| **Focus Bear** | subscription | routines for neurodiverse users. Win/Mac/iOS/Android |
| **ScreenZen** | **100% free** | Windows app too; free on all four consumer platforms |
| **RescueTime** | subscription | tracker first, FocusTime blocking bolted on |
| **Microsoft Family Safety** | free | the built-in default |

Cold Turkey does not and will not do mobile. FocusMe, Pluckeye, BlockerX and Focus
Bear are the only Windows blockers that also touch a phone, and none of them is
open source, and none has a real synced config document.

---

## Physical unlock (NFC and beacons)

| Product | Price | Catch |
| --- | --- | --- |
| **Brick** | $59 one-time, no sub | iOS 16.2+ **and Android 12+** (since Sept 2025). **5 lifetime emergency unlocks**, then you email support. Needs internet to toggle |
| **Unpluq** | tag $26.50, or ~$57 with a year included; ~$35/yr after | the tag is a paperweight without the subscription |
| **Blok** | $29 + $59.99/yr | subscription on top of hardware |
| **Bloom** | $39 one-time | steel NFC card, finicky scans |
| **ScreenZen Halo** | $49 one-time, no sub | **BLE beacon**, room-level ("in bed"), not a tap. ~2.5yr battery |
| **Aro** | $350 + $19.99/mo | lockbox |
| **Foqos / Normal / Switchly** | **free** | any $0.30 NTAG sticker, or a printed QR code |

The "$9 DIY Brick" tutorials are everywhere (MakeUseOf, Dorm Therapy, Yahoo Tech),
so demand for the free version is organic and proven. But read the last row
carefully: **Foqos, Normal and Switchly already serve it.** Shipping NFC unlock
does not differentiate YawningFace in 2026. *Not* shipping it disqualifies us.

The load-bearing details to copy (all proven by Foqos, MIT, iOS):

- **Same-tag-to-unlock**: store the tag identity, and only *that* tag ends the
  session (`physicalUnblockNFCTagId` pattern)
- Background tag read via a universal-link NDEF record, app opens, toggles the
  ManagedSettings shields
- **Strict mode** = prevent app deletion + shield Settings (the #1 bypass on iOS
  is revoking the Screen Time permission)
- **100% offline**: never require a server to block or unblock
- Generous emergency-unlock policy (Brick's 5-per-lifetime is a hostage mechanic,
  not a safety feature)
- Debounce NFC ghost scans

## Network-level blocking (the DIY cross-device answer)

The threat nobody in the app category talks about, and the closest thing to a free
"one brain, every device" that exists today.

| Tool | Price | Reality |
| --- | --- | --- |
| **NextDNS** | free tier, ~$20/yr | "Pi-hole in the cloud". Block TikTok/Instagram/Discord *by service*, with time windows, on every device on the account |
| **Pi-hole / AdGuard Home** | free, OSS | self-hosted, same idea, home network only |
| **Control D** | cheap subscription | scheduled profiles |
| **Tech Lockdown** | subscription | DNS plus device config, sold to power users as a bypass-proof system |

**Why this does not kill us:** DNS blocking is leaky and dumb. It cannot reliably
block a *native app* (TikTok on Android keeps working through a DNS block), it has
no concept of "this app but not that one", it dies the moment you leave WiFi, and
it blocks for everyone on the network rather than for you. But it is free, it is
genuinely cross-device, and technical users reach for it first. Our counter has to
be explicit: **we block the app on the device, not the domain on the network.**

## The AI landscape

Everything shipped is an **AI doorman**: it argues with you about a single unlock
moment.

| App | What its AI actually does |
| --- | --- |
| **Zario** | negotiate for extra minutes in chat; pay ~$2 to override. A Maastricht University study claims 88.87% of at-risk users cut usage within a week |
| **LOCKR** (MWM) | you type a *reason*, the coach judges it against a strictness setting and grants N minutes |
| **Zensi / ScreenCoach / Superhappy** | variations on the same |
| **Jomo** | AI photo-proof ("show me you're at the gym") |
| **FocusMe** | **AI Coach**: analyzes daily usage, detects patterns (burnout risk, schedule drift), and generates blocking-plan recommendations you apply with one click. The only shipped AI that touches the *rules* rather than one unlock |
| **Opal** | explicitly states it is *not* AI-driven |
| **Freedom / Cold Turkey** | zero AI |

**The narrow claim that survives:** nobody ships a *conversational* coach that
edits a *portable, user-owned* config under an explicit constitution, across
devices. FocusMe's coach is the closest prior art: real analysis, one-click plan
edits, but one-way (report -> suggestion), desktop-scoped, and the plans live
inside its closed format. The doorman fights you at the door; FocusMe hands you
tailoring suggestions; ours is the tailor you talk to, and you keep the suit
pattern. Say it that precisely or not at all.

## Location-based blocking

**No longer a differentiator.** AppBlock ships radius and inverse-radius rules,
plus WiFi-network triggers, to 15M+ users today. Also in this wave:
Geolock, GymLock, GeoFocus (2025-26).

iOS mechanism: CoreLocation region monitoring wakes the app, which toggles its
ManagedSettingsStore. Caveats: minutes of latency, ~100m granularity, requires
"Always" location permission. ScreenZen Halo's BLE beacon covers the room-level
indoor case GPS cannot reach.

The unclaimed version is the *combination*: a three-tier context system (NFC tap /
BLE room / GPS zone) does not exist as one product. But shipping GPS alone in
Phase 3 is catch-up, not a headline.

## The OS defaults

Worth saying out loud: **the biggest competitor is Apple Screen Time, Google
Digital Wellbeing and Microsoft Family Safety**, all free and pre-installed. The
entire third-party market exists because they are trivially bypassable. Every
competitor's marketing is, underneath, "Screen Time, but it actually holds". That
is the frame our first sentence has to win.

---

## What this means for YawningFace

**Threats, ranked by how much they should change the roadmap:**

1. **Foqos is not a footnote.** v2.1.0 shipped July 2026, 77 releases, 12 blocking
   strategies, 4.9 stars on 5000+ reviews, MIT, 108 forks. It owns the
   open-source-blocker mindshare. If Foqos ever adds a synced config, our wedge
   closes. The honest position is not "we're the open source one", it is **"we're
   the one that also runs on your laptop"**.
2. **AppBlock (15M users) already ships location and WiFi triggers.** That was
   filed as our Phase 3 differentiator. It is shipped, at scale, for $29.99/yr.
3. **Curbox's in-app UI hiding** (kill Reels and Shorts *inside* the app, leave
   the app usable) is a feature category we have nothing for, and it is arguably
   the most faithful expression of principle #1, sustainable beats radical. A user
   who keeps Instagram DMs but loses the Reels tab never has the "one bad moment"
   that makes them uninstall. **Strongly consider stealing this.**
4. **ScreenZen is 100% free on iOS, Android, macOS and Windows**, with no premium
   tier. It already crosses the phone/desktop line for $0. "Free" and "free +
   cross-device" are both dead as differentiators against it; what it lacks is
   open source, a synced user-owned config, and hard blocking (it pauses, we
   block). Watch it closely.
5. **Pluckeye already built delay-based friction**, which is principle #2. Not a
   commercial threat, but it means "smart friction" is not novel and should not be
   pitched as though it were.
6. **Freedom's free tier syncs across 5 platforms.** The attack on Freedom is not
   "it costs money". It is **"it charges you $40/yr for a schedule"**, and it is
   closed, and it cannot be self-hosted or extended.
7. **We are not the only cross-platform blocker, only the only open one.** Focus
   Bear, BlockerX, FocusMe and Pluckeye all span desktop and phone. Never claim
   "the only one on every device"; the true and checkable claim is **"the only
   open-source blocker that crosses the phone/desktop line"**.

**What is defensibly ours, in order:**

1. One config, phone **and** desktop, free and open source. Nobody else. Not one.
   (ScreenZen is free on all four platforms, but closed and without a synced,
   user-owned config.)
2. The conversational coach that rewrites your portable config. FocusMe's AI
   Coach is prior art for AI-edited rules; the conversation, the constitution,
   and the ownership are still ours alone.
3. The agent surface: an open contract that agents and terminals can edit.
   (FocusMe has a CLI remote control; claiming "only CLI" is now false.)
4. Self-hostable hub, offline-first, no server required to block or unblock (a
   direct shot at Brick, which needs internet to unbrick).
5. Generous emergency unlocks, said out loud, against Brick's 5-per-lifetime
   hostage mechanic.

**Table stakes, not features.** We need all of these just to be taken seriously:
NFC/QR physical unlock, a strict mode that survives permission revocation and app
deletion, an honest free tier, and a schedule.

## How this market actually distributes

Nearly every small competitor in this scan (Habit Doom, MindBack, Habi,
ScreenBuddy, Chronoid, Blok, DigitalZen, unhookd, Sip & Scroll, Screen Time Index,
Deep Work Zone, LiveIntently, Aftertone, Hugo, Refocus, FaithLock, Unstar,
Screenwise, Impulsec) runs the **same playbook**: a content farm of "best app
blockers 2026", "X vs Y", "X alternatives" posts, each ranking its own app politely
near the top. The category's organic search is saturated with it, and much of it is
written by the products themselves.

That is a channel YawningFace cannot win and should not fight. The channels that
suit a free, open-source, cross-device blocker are different, and Foqos has already
proven them: **Hacker News** ("Show HN: I made an app that uses NFC as a physical
switch" hit the front page), **r/digitalminimalism**, **F-Droid**, **GitHub
trending**, and the existing press appetite for "$9 DIY Brick" stories. Lead with
the repo and the CLI, not with a listicle.
