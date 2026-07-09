import { existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import type { BlockConfig } from "@yawningface/schema";
import { defaultConfig, validateConfigStrict } from "@yawningface/schema";
import { chatComplete, endpointFromEnv, type ChatMessage } from "../coach/client.js";
import { diffConfigs } from "../coach/diff.js";
import { buildSystemPrompt, extractProposal, stripProposal } from "../coach/prompt.js";
import { readConfig, resolveConfigPath } from "../util.js";

function writeConfig(path: string, config: BlockConfig): void {
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf8");
}

function printProposal(current: BlockConfig, proposal: BlockConfig): void {
  console.log("\nProposed change:");
  for (const line of diffConfigs(current, proposal)) {
    console.log(`  ${line}`);
  }
}

export async function runCoach(flags: {
  file?: string;
  once?: string;
  apply?: boolean;
}): Promise<number> {
  const endpoint = endpointFromEnv();
  if (typeof endpoint === "string") {
    console.error(`✗ ${endpoint}`);
    return 2;
  }

  const path = resolveConfigPath(flags.file);
  let current: BlockConfig;
  if (existsSync(path)) {
    try {
      current = readConfig(path);
    } catch (error) {
      console.error(`✗ ${(error as Error).message}`);
      return 1;
    }
  } else {
    current = defaultConfig();
    console.log(`(no config at ${path} yet — starting from the default; applying a change will create it)`);
  }

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(current, new Date()) },
  ];

  const handleReply = async (reply: string): Promise<BlockConfig | null> => {
    const text = stripProposal(reply);
    if (text.length > 0) {
      console.log(`\n${text}`);
    }
    const proposal = extractProposal(reply);
    if (proposal === null) return null;
    const problems = validateConfigStrict(proposal);
    if (problems.length > 0) {
      console.error("\n✗ the coach proposed an invalid config — not applying it:");
      for (const problem of problems.slice(0, 5)) {
        console.error(`  - ${problem}`);
      }
      return null;
    }
    printProposal(current, proposal as BlockConfig);
    return proposal as BlockConfig;
  };

  // One-shot mode: `yf coach --once "message" [--apply]`
  if (flags.once !== undefined) {
    if (flags.once.trim() === "") {
      console.error("✗ --once needs a message");
      return 1;
    }
    messages.push({ role: "user", content: flags.once });
    let reply: string;
    try {
      reply = await chatComplete(endpoint, messages);
    } catch (error) {
      console.error(`✗ ${(error as Error).message}`);
      return 1;
    }
    const proposal = await handleReply(reply);
    if (proposal !== null) {
      if (flags.apply) {
        writeConfig(path, proposal);
        console.log(`\n✓ applied to ${path}`);
      } else {
        console.log(`\n(not applied — re-run with --apply, or use "yf coach" interactively)`);
      }
    }
    return 0;
  }

  // Interactive mode.
  if (!process.stdin.isTTY) {
    console.error('✗ not a terminal — use: yf coach --once "your message" [--apply]');
    return 1;
  }

  console.log(`YawningFace Coach — opt-in AI (${endpoint.model} via ${endpoint.baseUrl})`);
  console.log("Your config and messages are sent to that endpoint; nothing else is.");
  console.log('Talk about your life, ask for changes, or type "/quit" to leave.\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let pendingNote = "";
  try {
    for (;;) {
      const input = (await rl.question("you › ")).trim();
      if (input === "") continue;
      if (input === "/quit" || input === "/exit") break;

      messages.push({ role: "user", content: pendingNote + input });
      pendingNote = "";

      let reply: string;
      try {
        reply = await chatComplete(endpoint, messages);
      } catch (error) {
        console.error(`✗ ${(error as Error).message}`);
        messages.pop();
        continue;
      }
      messages.push({ role: "assistant", content: reply });

      const proposal = await handleReply(reply);
      if (proposal !== null) {
        const answer = (await rl.question("\nApply this change? [y/N] ")).trim().toLowerCase();
        if (answer === "y" || answer === "yes") {
          writeConfig(path, proposal);
          current = proposal;
          console.log(`✓ applied to ${path}\n`);
          pendingNote = "[I applied that change.] ";
        } else {
          console.log("(not applied)\n");
          pendingNote = "[I did not apply that change.] ";
        }
      } else {
        console.log("");
      }
    }
  } finally {
    rl.close();
  }
  return 0;
}
