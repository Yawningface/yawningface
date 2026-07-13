# Installer artwork

The Windows installer is NSIS (that is what Tauri bundles), so its two images
are the whole visual budget. They are built from the same public-domain
engravings as [the website](https://yawningface.com), in the same yellow.

| File | Size | Where it shows |
| --- | --- | --- |
| `src-tauri/icons/installer-sidebar.bmp` | 164x314 | Welcome and Finish pages. Odysseus bound to the mast, which is the product in one picture. |
| `src-tauri/icons/installer-header.bmp` | 150x57 | The strip along the top of every other page. The Sirens, crowding in from the left. |

## Regenerating them

The sources are HTML (`sidebar.html`, `header.html`) because the art ships as
`.webp`, which Chrome can decode and .NET cannot. Render, then convert to the
24-bit BMP that NSIS requires:

```powershell
$art = "https://yawningface-website.vercel.app/art/tri"   # mast.webp, sirens.webp
# fetch the webp files next to the html, plus src/fonts/InstrumentSerif.woff2
chrome --headless=new --screenshot=sidebar.png --window-size=164,314 sidebar.html
chrome --headless=new --screenshot=header.png  --window-size=150,57  header.html
# then save each as a 24-bit BMP into src-tauri/icons/
```

## The honest limit

This is still the Windows wizard: NSIS themed, not replaced. A fully custom
installer window (the Hermes shape) means shipping a second application whose
only job is to install the first one, and it buys nothing the first-run window
in the app does not already do better. The wizard's job here is to get out of
the way fast; the welcome that matters is the one in `src/Onboarding.tsx`.
