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
  assert.match(background, /state\?\.domains\.includes\(msg\.domain\)/);
  assert.doesNotMatch(background, /startSession|evaluate\(/);
  assert.match(rules, /declarativeNetRequest\.updateDynamicRules/);
  assert.match(rules, /blocked\.html/);
  assert.match(native, /type: "get_state"/);
  assert.match(native, /type: "unblock_request"/);
});
