import type { BlockConfig, Blocklist } from "@yawningface/schema";
import { renderWindows } from "../util.js";

function summarize(list: Blocklist): string {
  return `${renderWindows(list.metadata.timePeriods)} · ${list.targets.websites.length} website(s), ${list.targets.apps.length} app(s) · ${list.metadata.devices.join("/")}`;
}

function describeChanges(before: Blocklist, after: Blocklist): string[] {
  const changes: string[] = [];
  if (before.name !== after.name) {
    changes.push(`renamed "${before.name}" → "${after.name}"`);
  }
  if (before.metadata.enabled !== after.metadata.enabled) {
    changes.push(after.metadata.enabled ? "enabled" : "disabled");
  }
  if (before.metadata.severity !== after.metadata.severity) {
    changes.push(`severity ${before.metadata.severity} → ${after.metadata.severity}`);
  }
  const beforeDevices = [...before.metadata.devices].sort().join(",");
  const afterDevices = [...after.metadata.devices].sort().join(",");
  if (beforeDevices !== afterDevices) {
    changes.push(`devices → ${after.metadata.devices.join(", ") || "none"}`);
  }
  const beforeWindows = renderWindows(before.metadata.timePeriods);
  const afterWindows = renderWindows(after.metadata.timePeriods);
  if (beforeWindows !== afterWindows) {
    changes.push(`windows: ${beforeWindows} → ${afterWindows}`);
  }
  for (const key of ["websites", "apps"] as const) {
    const beforeSet = new Set(before.targets[key]);
    const afterSet = new Set(after.targets[key]);
    const added = [...afterSet].filter((x) => !beforeSet.has(x));
    const removed = [...beforeSet].filter((x) => !afterSet.has(x));
    if (added.length > 0) changes.push(`+${key}: ${added.join(", ")}`);
    if (removed.length > 0) changes.push(`−${key}: ${removed.join(", ")}`);
  }
  return changes;
}

/** Human-readable summary of what a proposed config changes. */
export function diffConfigs(before: BlockConfig, after: BlockConfig): string[] {
  const lines: string[] = [];
  const beforeById = new Map(before.blocklists.map((l) => [l.id, l]));
  const afterById = new Map(after.blocklists.map((l) => [l.id, l]));

  for (const [id, list] of afterById) {
    if (!beforeById.has(id)) {
      lines.push(`+ added "${list.name}" (${id}): ${summarize(list)}`);
    }
  }
  for (const [id, list] of beforeById) {
    if (!afterById.has(id)) {
      lines.push(`− removed "${list.name}" (${id})`);
    }
  }
  for (const [id, afterList] of afterById) {
    const beforeList = beforeById.get(id);
    if (!beforeList) continue;
    const changes = describeChanges(beforeList, afterList);
    if (changes.length > 0) {
      lines.push(`~ ${afterList.name} (${id}): ${changes.join("; ")}`);
    }
  }
  if (lines.length === 0) {
    lines.push("(no effective changes)");
  }
  return lines;
}
