import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "dist", "index.js");
const fixtures = join(here, "..", "..", "..", "packages", "schema", "fixtures");

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      YF_DISABLE_DOTENV: "1",
      OPENCODE_API_KEY: "",
      YF_CONFIG: "",
      ...options.env,
    },
    cwd: options.cwd ?? here,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("--version prints the version", () => {
  const { code, stdout } = run(["--version"]);
  assert.equal(code, 0);
  assert.equal(stdout.trim(), "0.1.0");
});

test("help is shown when no command is given", () => {
  const { code, stdout } = run([]);
  assert.equal(code, 0);
  assert.match(stdout, /talk to your blocker/);
});

test("validate accepts a valid config", () => {
  const { code, stdout } = run(["validate", "--file", join(fixtures, "valid", "default.json")]);
  assert.equal(code, 0);
  assert.match(stdout, /valid YawningFace config/);
});

test("validate rejects a broken config with details", () => {
  const { code, stderr } = run(["validate", "--file", join(fixtures, "invalid", "bad-time.json")]);
  assert.equal(code, 1);
  assert.match(stderr, /HH:MM/);
});

test("validate explains a missing file", () => {
  const { code, stderr } = run(["validate", "--file", join(here, "nope.json")]);
  assert.equal(code, 1);
  assert.match(stderr, /yf init/);
});

test("init writes a strict-valid config and refuses accidental overwrite", () => {
  const dir = mkdtempSync(join(tmpdir(), "yf-test-"));
  const file = join(dir, "yawningface.json");

  const first = run(["init", "--template", "better-sleep-nights", "--file", file]);
  assert.equal(first.code, 0, first.stderr);
  const config = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(config.version, 1);
  assert.equal(config.blocklists[0].id, "better-sleep-nights");
  assert.equal(config.blocklists[0].metadata.timePeriods[0].startTime, "21:30");

  const validated = run(["validate", "--file", file]);
  assert.equal(validated.code, 0);

  const second = run(["init", "--template", "social-detox", "--file", file]);
  assert.equal(second.code, 1);
  assert.match(second.stderr, /--force/);

  const forced = run(["init", "--template", "social-detox", "--file", file, "--force"]);
  assert.equal(forced.code, 0);
});

test("init rejects an unknown template and lists the real ones", () => {
  const { code, stderr } = run(["init", "--template", "does-not-exist", "--file", join(tmpdir(), "x.json")]);
  assert.equal(code, 1);
  assert.match(stderr, /stress-free-mornings/);
});

test("show renders blocklists and the right-now evaluation", () => {
  const { code, stdout } = run(["show", "--file", join(fixtures, "valid", "default.json")]);
  assert.equal(code, 0);
  assert.match(stdout, /Morning Focus/);
  assert.match(stdout, /Mon–Fri 09:00–13:00/);
  assert.match(stdout, /Right now/);
  assert.match(stdout, /desktop/);
});

test("coach without a key exits 2 and explains the opt-in", () => {
  const { code, stderr } = run(["coach", "--once", "hello"]);
  assert.equal(code, 2);
  assert.match(stderr, /OPENCODE_API_KEY/);
  assert.match(stderr, /opt-in/);
});

test("unknown commands fail loudly", () => {
  const { code, stderr } = run(["frobnicate"]);
  assert.equal(code, 1);
  assert.match(stderr, /unknown command/);
});
