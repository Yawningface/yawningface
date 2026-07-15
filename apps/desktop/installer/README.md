# Installer artwork

The Windows installer is NSIS (that is what Tauri bundles), so its two images
are the whole visual budget. They are built from the same public-domain
engravings as [the website](https://yawningface.com), in the same yellow.

| File | Size | Where it shows |
| --- | --- | --- |
| `src-tauri/icons/installer-sidebar.bmp` | 164x314 | Welcome and Finish pages. Goya's *The Sleep of Reason Produces Monsters*. |
| `src-tauri/icons/installer-header.bmp` | 150x57 | The shared strip on the installer's inner pages. The group plate sits to the left of the wordmark. |
| `src-tauri/icons/installer-uninstaller-header.bmp` | 150x57 | The shared strip on the uninstaller pages, with its own plate to the left of the same wordmark. |

## Regenerating them

The sources are HTML (`sidebar.html`, `header.html`) because the art ships as
`.webp`, which Chrome can decode and .NET cannot. Render, then convert to the
24-bit BMP that NSIS requires:

```powershell
$art = "https://raw.githubusercontent.com/Yawningface/marketing/master/public/yellow/plates"
New-Item -ItemType Directory -Force art
Invoke-WebRequest "$art/goya-sleep-of-reason.webp" -OutFile "art/goya-sleep-of-reason.webp"
Invoke-WebRequest "$art/captura-de-pantalla-2026-07-13-105001.webp" -OutFile "art/captura-de-pantalla-2026-07-13-105001.webp"
Invoke-WebRequest "$art/captura-de-pantalla-2026-07-13-104918.webp" -OutFile "art/captura-de-pantalla-2026-07-13-104918.webp"
Copy-Item "../src/fonts/InstrumentSerif.woff2" .
chrome --headless=new --screenshot=sidebar.png --window-size=164,314 sidebar.html
chrome --headless=new --screenshot=header.png  --window-size=150,57  header.html
chrome --headless=new --screenshot=uninstaller-header.png --window-size=150,57 uninstaller-header.html
# then save each as a 24-bit BMP into src-tauri/icons/
```

## The honest limit

This is still the Windows wizard: NSIS themed, not replaced. A fully custom
installer window (the Hermes shape) means shipping a second application whose
only job is to install the first one. The wizard's job here is to get out of
the way fast; after installation, the app opens directly to its main Focus
screen.
