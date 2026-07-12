import type { DeviceKind } from "@yawningface/schema";
import { DEVICE_KINDS, dayKeyFromDate, evaluate } from "@yawningface/schema";
import { readConfig, renderWindows, resolveConfigPath } from "../util.js";

export function runShow(fileFlag: string | undefined): number {
  const path = resolveConfigPath(fileFlag);
  let config;
  try {
    config = readConfig(path);
  } catch (error) {
    console.error(`✗ ${(error as Error).message}`);
    return 1;
  }

  console.log(`${path}\n`);
  if (config.blocklists.length === 0) {
    console.log("  (no blocklists - try \"yf init\" or \"yf coach\")");
  }
  for (const list of config.blocklists) {
    const state = list.metadata.enabled ? "●" : "○";
    const severity = list.metadata.severity === "warn" ? "warn" : "block";
    console.log(`${state} ${list.name} (${list.id})`);
    console.log(`    ${severity} on ${list.metadata.devices.join(", ") || "no devices"}`);
    console.log(`    ${renderWindows(list.metadata.timePeriods)}`);
    console.log(`    websites: ${list.targets.websites.join(", ") || " - "}`);
    console.log(`    apps:     ${list.targets.apps.join(", ") || " - "}`);
    console.log("");
  }

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  console.log(`Right now (${dayKeyFromDate(now)} ${hh}:${mm}):`);
  for (const device of DEVICE_KINDS as readonly DeviceKind[]) {
    const set = evaluate(config, device, now);
    const summary =
      set.domains.size === 0 && set.apps.size === 0
        ? "nothing blocked"
        : `blocking ${set.domains.size} domain(s), ${set.apps.size} app(s)` +
          (set.activeLists.length > 0 ? ` via ${set.activeLists.join(", ")}` : "");
    console.log(`  ${device.padEnd(7)} ${summary}`);
  }
  return 0;
}
