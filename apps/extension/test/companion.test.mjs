import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(`../src/${name}`, import.meta.url), "utf8");

test("manifest stays a narrow desktop companion", async () => {
  const manifest = JSON.parse(await read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes("nativeMessaging"));
  assert.ok(manifest.permissions.includes("declarativeNetRequest"));
  assert.ok(!manifest.permissions.includes("identity"));
  assert.ok(!manifest.permissions.includes("tabs"));
});

test("blocked page has unique ids and a required reason", async () => {
  const html = await read("blocked.html");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(html, /id="excuse"[\s\S]*maxlength="500"[\s\S]*required/);
  assert.match(html, /Unblock for 10 minutes/);
  assert.match(html, /written to desktop Insights/);
});

test("desktop state drives rules and exceptions", async () => {
  const [background, rules, native] = await Promise.all([
    read("background.ts"),
    read("rules.ts"),
    read("native.ts"),
  ]);
  assert.match(background, /applyDesktopState/);
  assert.match(background, /requestDesktopUnblock/);
  assert.match(background, /response\.domains\?\.length/);
  assert.match(background, /state\?\.domains\.includes\(msg\.domain\)/);
  assert.doesNotMatch(background, /startSession|evaluate\(/);
  assert.match(rules, /declarativeNetRequest\.updateDynamicRules/);
  assert.match(rules, /blocked\.html/);
  assert.match(background, /state\?\.excludedDomains \?\? \[\]/);
  assert.match(rules, /excludedDomains: string\[\]/);
  assert.match(rules, /excludedRequestDomains/);
  assert.match(rules, /&h=\\\\1#\\\\0/);
  assert.doesNotMatch(rules, /music\.youtube\.com/);
  assert.match(native, /type: "get_state"/);
  assert.match(native, /type: "unblock_request"/);
  assert.match(native, /appearance\?: "system" \| "light" \| "dark"/);
  assert.match(native, /document\.documentElement\.dataset\.theme/);
});

test("blocked page uses Goya and offers explicit working exits", async () => {
  const [html, css, script] = await Promise.all([
    read("blocked.html"),
    read("ui.css"),
    read("blocked.ts"),
  ]);
  assert.match(html, /Goya's etching The Sleep of Reason Produces Monsters/);
  assert.match(html, /class="blocked-exit"/);
  assert.match(html, /Close this tab/);
  assert.match(html, /Unblock with a reason/);
  assert.doesNotMatch(html, /focused today|times you came here|unblocks today/);
  assert.match(css, /url\("art\/goya\.webp"\)/);
  assert.match(css, /\.unblock-entry[\s\S]*background: transparent/);
  assert.match(css, /\.unblock-entry[\s\S]*text-decoration: underline/);
  assert.match(script, /by blocking schedule \"\$\{schedule\}\"/);
  assert.match(script, /by your working session/);
  assert.match(script, /originalBlockedUrl\(location\.hash\.slice\(1\), domain\)/);
  assert.match(script, /host\.endsWith\(`\.\$\{policyDomain\}`\)/);
  assert.match(script, /location\.href = returnUrl/);
  assert.match(script, /chrome\.tabs\.remove\(tab\.id\)/);
  assert.match(script, /Continue to \$\{requestedHost\}/);
  assert.doesNotMatch(script, /about:blank/);
});
