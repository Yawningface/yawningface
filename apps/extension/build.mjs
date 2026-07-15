/**
 * Builds the extension into dist/, ready for "Load unpacked".
 *
 * The output is intentionally only a desktop companion. Session evaluation,
 * schedules, accounts, and exemption policy remain in the desktop app.
 */

import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const watch = process.argv.includes("--watch");
const out = "dist";

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const options = {
  entryPoints: [
    "src/background.ts",
    "src/popup.ts",
    "src/options.ts",
    "src/blocked.ts",
  ],
  outdir: out,
  bundle: true,
  format: "esm",
  target: "chrome120",
  sourcemap: watch,
  minify: !watch,
  logLevel: "info",
};

async function copyAssets() {
  // Static files, copied verbatim.
  for (const f of [
    "manifest.json",
    "popup.html",
    "options.html",
    "blocked.html",
    "ui.css",
  ]) {
    await cp(`src/${f}`, `${out}/${f}`);
  }

  // The fonts and the engraving are shared with the desktop app and the site.
  await mkdir(`${out}/fonts`, { recursive: true });
  await cp("../desktop/src/fonts/Geist.woff2", `${out}/fonts/Geist.woff2`);
  await cp(
    "../desktop/src/fonts/InstrumentSerif.woff2",
    `${out}/fonts/InstrumentSerif.woff2`,
  );

  if (existsSync("assets/art")) {
    await cp("assets/art", `${out}/art`, { recursive: true });
  }
  if (existsSync("assets/icons")) {
    await cp("assets/icons", `${out}/icons`, { recursive: true });
  }
}

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  await copyAssets();
  console.log("watching...");
} else {
  await build(options);
  await copyAssets();
  console.log(`built -> ${out}/`);
}
