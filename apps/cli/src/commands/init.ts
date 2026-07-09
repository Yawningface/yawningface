import { existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import type { BlockConfig } from "@yawningface/schema";
import { validateConfigStrict } from "@yawningface/schema";
import { renderWindows, resolveConfigPath } from "../util.js";

const SOCIAL_WEBSITES = [
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "reddit.com",
  "tiktok.com",
  "snapchat.com",
  "pinterest.com",
  "tumblr.com",
  "linkedin.com",
];

interface Template {
  id: string;
  title: string;
  description: string;
  config: BlockConfig;
}

/**
 * The three starter shapes from the original 2025 design, plus an always-on
 * detox list. Every template starts enabled — running init is the consent.
 */
export const TEMPLATES: Template[] = [
  {
    id: "stress-free-mornings",
    title: "Stress-free mornings",
    description: "No feeds until lunch, so the day starts with your brain unstimulated.",
    config: {
      version: 1,
      blocklists: [
        {
          id: "stress-free-mornings",
          name: "Stress-free mornings",
          metadata: {
            enabled: true,
            severity: "block",
            devices: ["desktop", "mobile", "tablet"],
            timePeriods: [{ startTime: "06:00", endTime: "12:00", schedule: [] }],
          },
          targets: { websites: [...SOCIAL_WEBSITES], apps: [] },
          exceptions: [],
        },
      ],
    },
  },
  {
    id: "freedom-afternoons",
    title: "Freedom afternoons",
    description: "Feeds blocked during the deep-work half of the day.",
    config: {
      version: 1,
      blocklists: [
        {
          id: "freedom-afternoons",
          name: "Freedom afternoons",
          metadata: {
            enabled: true,
            severity: "block",
            devices: ["desktop", "mobile", "tablet"],
            timePeriods: [
              { startTime: "14:00", endTime: "19:00", schedule: ["mon", "tue", "wed", "thu", "fri"] },
            ],
          },
          targets: { websites: [...SOCIAL_WEBSITES], apps: [] },
          exceptions: [],
        },
      ],
    },
  },
  {
    id: "better-sleep-nights",
    title: "Better sleep nights",
    description: "Feeds off from the evening until morning, so bed means sleep.",
    config: {
      version: 1,
      blocklists: [
        {
          id: "better-sleep-nights",
          name: "Better sleep nights",
          metadata: {
            enabled: true,
            severity: "block",
            devices: ["desktop", "mobile", "tablet"],
            timePeriods: [{ startTime: "21:30", endTime: "07:00", schedule: [] }],
          },
          targets: { websites: [...SOCIAL_WEBSITES], apps: [] },
          exceptions: [],
        },
      ],
    },
  },
  {
    id: "social-detox",
    title: "Social detox",
    description: "Feeds blocked around the clock. For a proper reset.",
    config: {
      version: 1,
      blocklists: [
        {
          id: "social-detox",
          name: "Social detox",
          metadata: {
            enabled: true,
            severity: "block",
            devices: ["desktop", "mobile", "tablet"],
          },
          targets: { websites: [...SOCIAL_WEBSITES], apps: [] },
          exceptions: [],
        },
      ],
    },
  },
];

export async function runInit(flags: {
  template?: string;
  file?: string;
  force?: boolean;
}): Promise<number> {
  const path = resolveConfigPath(flags.file);
  if (existsSync(path) && !flags.force) {
    console.error(`✗ ${path} already exists — pass --force to overwrite it`);
    return 1;
  }

  let template = TEMPLATES.find((t) => t.id === flags.template);
  if (flags.template && !template) {
    console.error(`✗ unknown template "${flags.template}"`);
    console.error(`  available: ${TEMPLATES.map((t) => t.id).join(", ")}`);
    return 1;
  }

  if (!template) {
    if (!process.stdin.isTTY) {
      console.error("✗ no template chosen — pass --template <id>");
      console.error(`  available: ${TEMPLATES.map((t) => t.id).join(", ")}`);
      return 1;
    }
    console.log("Pick a starting point (everything is editable later):\n");
    TEMPLATES.forEach((t, i) => {
      const windows = renderWindows(t.config.blocklists[0].metadata.timePeriods);
      console.log(`  ${i + 1}. ${t.title} — ${t.description} (${windows})`);
    });
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("\nNumber [1]: ")).trim();
    rl.close();
    const index = answer === "" ? 0 : Number(answer) - 1;
    template = TEMPLATES[index];
    if (!template) {
      console.error("✗ that wasn't one of the options");
      return 1;
    }
  }

  const problems = validateConfigStrict(template.config);
  if (problems.length > 0) {
    console.error(`✗ internal error: template is invalid: ${problems.join("; ")}`);
    return 1;
  }

  writeFileSync(path, JSON.stringify(template.config, null, 2) + "\n", "utf8");
  console.log(`✓ wrote ${path} (${template.title})`);
  console.log(`  next: "yf show" to see it, "yf coach" to make it yours`);
  return 0;
}
