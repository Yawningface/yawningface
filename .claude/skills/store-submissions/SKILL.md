---
name: store-submissions
description: Use when preparing App Store or Chrome Web Store submissions, store listings, privacy policies, or when a store rejects a build. Collects the org's prior submission experience.
---

# Store submissions — prior art and landmines

## App Store (iPhone)

- Ready-made materials exist: `apps/iphone/appstore/` has the listing draft,
  privacy policy, screenshots, and `SUBMISSION_CHECKLIST.md` from the April
  2026 App-Store-ready snapshot. Start there, don't rewrite from scratch.
- **Blocker #1 is the Family Controls distribution entitlement** — per
  bundle ID *and* per extension, via Apple's request form, weeks of lead
  time. Nothing ships without it. ([[ios-screentime]] has the details.)
- Privacy angle is our strength: local-first, no tracking, open source —
  say so in the listing and privacy nutrition labels.
- ASO lesson (from the Burnout Buddy case study in the 2025 notes): keyword
  strategy beats feature lists; target the niche terms first ("app blocker
  nfc", "screen time open source"), not "focus".

## Chrome Web Store (extension)

- The org has shipped there twice (`block_chromium`, `browser-start-page`).
- **Real rejection experienced:** `browser-start-page` was rejected until the
  search bar was removed — the Web Store is strict about search-engine-like
  functionality and unused permissions. Request the *minimum* permission set;
  `declarativeNetRequest` (the Phase-1 engine) reads far better in review
  than `tabs` + `<all_urls>` host permissions with a redirect engine.
- Listing needs: 128/48/16 icons, screenshots, a privacy-practices
  disclosure for every permission.

## Google Play (Android, later)

- Avoid declaring an AccessibilityService in v1 — blockers using it face a
  heavy disclosure/consent review. The UsageStats + overlay pattern
  (`apps/android/README.md`) stays inside normal policy; UsageStats access
  itself requires the user to grant "Usage access" in Settings (guide them).
