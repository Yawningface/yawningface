import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultConfig,
  validateConfig,
  validateConfigStrict,
  evaluateAt,
  evaluate,
  normalizeDomain,
  dayKeyFromDate,
} from "../dist/index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const loadFixture = (kind, name) =>
  JSON.parse(readFileSync(join(fixturesDir, kind, name), "utf8"));

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("every valid fixture passes both validators", () => {
  for (const name of readdirSync(join(fixturesDir, "valid"))) {
    const config = loadFixture("valid", name);
    assert.equal(validateConfig(config), null, `${name} (minimal)`);
    assert.deepEqual(validateConfigStrict(config), [], `${name} (strict)`);
  }
});

test("every invalid fixture fails strict validation", () => {
  for (const name of readdirSync(join(fixturesDir, "invalid"))) {
    const problems = validateConfigStrict(loadFixture("invalid", name));
    assert.ok(problems.length > 0, `${name} should be rejected`);
  }
});

test("minimal validator matches the cloud's leniency", () => {
  // The server rejects these...
  assert.notEqual(validateConfig(loadFixture("invalid", "wrong-version.json")), null);
  assert.notEqual(validateConfig(loadFixture("invalid", "missing-id.json")), null);
  // ...but deliberately accepts malformed times (clients fail closed instead).
  assert.equal(validateConfig(loadFixture("invalid", "bad-time.json")), null);
});

test("defaultConfig is strictly valid", () => {
  assert.deepEqual(validateConfigStrict(defaultConfig()), []);
});

test("strict validation flags duplicated ids", () => {
  const config = defaultConfig();
  config.blocklists.push(structuredClone(config.blocklists[0]));
  const problems = validateConfigStrict(config);
  assert.ok(problems.some((p) => p.includes("duplicated")));
});

// ---------------------------------------------------------------------------
// Evaluation — parity with apps/desktop/src-tauri/src/schedule.rs tests
// ---------------------------------------------------------------------------

const rustParityConfig = {
  version: 1,
  blocklists: [
    {
      id: "focus",
      name: "Focus",
      metadata: {
        enabled: true,
        devices: ["desktop"],
        timePeriods: [
          {
            startTime: "09:00",
            endTime: "13:00",
            schedule: ["mon", "tue", "wed", "thu", "fri"],
          },
        ],
      },
      targets: { websites: ["https://www.Twitter.com/home"], apps: ["Discord"] },
    },
  ],
};

test("parity: active inside period", () => {
  const set = evaluateAt(rustParityConfig, 10 * 60, "mon", "desktop");
  assert.ok(set.domains.has("twitter.com"));
  assert.ok(set.apps.has("Discord"));
  assert.deepEqual(set.activeLists, ["Focus"]);
});

test("parity: inactive outside period and day", () => {
  assert.equal(evaluateAt(rustParityConfig, 14 * 60, "mon", "desktop").domains.size, 0);
  assert.equal(evaluateAt(rustParityConfig, 10 * 60, "sat", "desktop").domains.size, 0);
});

test("parity: midnight crossing", () => {
  const config = {
    blocklists: [
      {
        name: "Night",
        metadata: {
          enabled: true,
          timePeriods: [{ startTime: "22:00", endTime: "07:00" }],
        },
        targets: { websites: ["youtube.com"] },
      },
    ],
  };
  assert.ok(evaluateAt(config, 23 * 60, "mon", "desktop").domains.size > 0);
  assert.ok(evaluateAt(config, 6 * 60, "tue", "desktop").domains.size > 0);
  assert.equal(evaluateAt(config, 12 * 60, "mon", "desktop").domains.size, 0);
});

test("equal start and end means the whole day", () => {
  const config = {
    blocklists: [
      {
        name: "All day",
        metadata: {
          enabled: true,
          timePeriods: [{ startTime: "08:00", endTime: "08:00" }],
        },
        targets: { websites: ["reddit.com"] },
      },
    ],
  };
  assert.ok(evaluateAt(config, 3 * 60, "sun", "desktop").domains.has("reddit.com"));
});

test("malformed times fail closed towards blocking", () => {
  const config = {
    blocklists: [
      {
        name: "Broken",
        metadata: {
          enabled: true,
          timePeriods: [{ startTime: "25:00", endTime: "9pm" }],
        },
        targets: { websites: ["twitter.com"] },
      },
    ],
  };
  assert.ok(evaluateAt(config, 12 * 60, "wed", "desktop").domains.has("twitter.com"));
});

test("device filter is honoured, missing filter applies everywhere", () => {
  assert.equal(evaluateAt(rustParityConfig, 10 * 60, "mon", "mobile").domains.size, 0);
  const noFilter = {
    blocklists: [
      {
        name: "Everywhere",
        metadata: { enabled: true },
        targets: { websites: ["tiktok.com"] },
      },
    ],
  };
  for (const device of ["desktop", "mobile", "tablet"]) {
    assert.ok(evaluateAt(noFilter, 0, "mon", device).domains.has("tiktok.com"));
  }
});

test("disabled blocklists are never enforced", () => {
  const config = structuredClone(rustParityConfig);
  config.blocklists[0].metadata.enabled = false;
  assert.equal(evaluateAt(config, 10 * 60, "mon", "desktop").domains.size, 0);
});

test("day names in schedules match by prefix, any case", () => {
  const config = structuredClone(rustParityConfig);
  config.blocklists[0].metadata.timePeriods[0].schedule = ["Monday"];
  assert.ok(evaluateAt(config, 10 * 60, "mon", "desktop").domains.size > 0);
});

test("normalizeDomain matches the Rust implementation", () => {
  assert.equal(normalizeDomain("https://www.Twitter.com/foo"), "twitter.com");
  assert.equal(normalizeDomain("Twitter.com"), "twitter.com");
  assert.equal(normalizeDomain("  http://youtube.com/watch?v=x "), "youtube.com");
  assert.equal(normalizeDomain("localhost"), "");
  assert.equal(normalizeDomain("not a domain!"), "");
  assert.equal(normalizeDomain(""), "");
});

test("dayKeyFromDate is Monday-first", () => {
  // 2026-07-09 is a Thursday; 2026-07-12 is a Sunday.
  assert.equal(dayKeyFromDate(new Date(2026, 6, 9, 12, 0)), "thu");
  assert.equal(dayKeyFromDate(new Date(2026, 6, 12, 12, 0)), "sun");
});

test("evaluate() uses local wall-clock time", () => {
  const config = loadFixture("valid", "night-owl.json");
  const insideWindow = new Date(2026, 6, 9, 23, 30); // Thu 23:30 local
  const outsideWindow = new Date(2026, 6, 9, 12, 0); // Thu 12:00 local
  assert.ok(evaluate(config, "mobile", insideWindow).domains.has("youtube.com"));
  assert.equal(evaluate(config, "mobile", outsideWindow).domains.size, 0);
  // night-owl targets mobile+tablet only.
  assert.equal(evaluate(config, "desktop", insideWindow).domains.size, 0);
});
