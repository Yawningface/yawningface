---
name: desktop-release
description: Use when the user asks to build, version, tag, release, or troubleshoot the desktop app (apps/desktop) — Mac/Windows installers, the GitHub Actions release pipeline, draft releases, version bumps, or build-cache issues.
---

# Desktop release — Mac & Windows installers from GitHub Actions

System adapted from turbo-screenshot's proven pipeline. Two workflows at the
repo root (nested `.github` dirs inside apps/ never run — that's why the old
one was deleted):

| Workflow | Trigger | Output |
| --- | --- | --- |
| `.github/workflows/desktop-release.yml` | push tag `desktop-v*`, or manual dispatch | tag → **draft GitHub Release** with installers; dispatch → **workflow artifacts** only (build verification, no release) |
| `.github/workflows/desktop-cache-warm.yml` | push to main touching `apps/desktop/src-tauri/Cargo.{lock,toml}`, weekly cron, manual | writes the shared Rust cache on main |

Builds: Windows NSIS `.exe`/`.msi` (windows-latest) and macOS Apple-Silicon
`.dmg`/`.app` (macos-latest, `--target aarch64-apple-darwin`). A `cargo test`
gate runs before every build (schedule engine + hosts tests).

## Trigger a verification build (no release)

```powershell
gh workflow run desktop-release.yml
gh run list --workflow desktop-release --limit 3
gh run watch <run-id>
```

Installers appear as artifacts named `yawningface-desktop-<platform>` on the
run page (`gh run download <run-id>`).

## Cut a real release

1. Bump **all three** version fields together, keep them identical:
   - `apps/desktop/package.json`
   - `apps/desktop/src-tauri/Cargo.toml`
   - `apps/desktop/src-tauri/tauri.conf.json`
2. Commit to main, then tag and push — **the tag prefix is `desktop-v`**
   (monorepo: other apps get their own prefixes later):
   ```powershell
   git commit -am "desktop: release v0.1.2"
   git push
   git tag desktop-v0.1.2
   git push origin desktop-v0.1.2
   ```
3. Watch: `gh run watch`. Then inspect the **draft** release
   (`gh release list`) — check both installers are attached — and publish it
   in the GitHub UI. Draft-by-design: nothing goes public without eyes on it.

## The cache system (don't break it)

GitHub Actions caches are branch-scoped: tag runs can only *restore* caches
created on the default branch. So `desktop-cache-warm` (main-only) **owns
writing** the shared slot `desktop-release`, and the release workflow sets
`save-if: 'false'` — it restores, never writes. Break that discipline and
every release recompiles ~400 crates cold (~15 min). Warm runs on Windows
only; the mac leg builds cold (macOS runners cost 10× minutes while the repo
is private — free when it goes public).

## Unsigned-build warnings (expected, not failures)

- **Windows SmartScreen**: "More info" → "Run anyway".
- **macOS Gatekeeper**: unsigned dmg → right-click → Open (or
  `xattr -cr /Applications/YawningFace\ Block.app`). Real signing/notarization
  (Apple Developer cert + `TAURI_SIGNING_*` secrets) is a Phase-1 roadmap item.

## Troubleshooting

- Fails in `npm ci` / Node setup → check `apps/desktop/package-lock.json` in
  sync with `package.json`.
- Fails in `cargo test` → a real regression in the engine; fix before
  shipping, don't skip the gate.
- Fails inside tauri-action → read `apps/desktop/src-tauri/tauri.conf.json`
  first (identifier `org.yawningface.block.desktop`, `bundle.targets: "all"`,
  icons), then crate errors.
- No release appeared → the tag must start with `desktop-v` and be pushed to
  origin; dispatch runs never create releases by design.
- Artifact upload empty on dispatch → bundle paths changed; check
  `target/**/release/bundle/` layout in the build log.
