#!/usr/bin/env node
import { runCoach } from "./commands/coach.js";
import { runInit } from "./commands/init.js";
import { runShow } from "./commands/show.js";
import { runValidate } from "./commands/validate.js";
import { loadDotEnv } from "./util.js";

const VERSION = "0.1.0";

const HELP = `yf - talk to your blocker

Usage
  yf init [--template <id>] [--file <path>] [--force]    create a starter config
  yf show [--file <path>]                                the config, and what's blocked right now
  yf validate [--file <path>]                            strict-check a config
  yf coach [--once "<msg>"] [--apply] [--file <path>]    reshape the config by talking (opt-in AI)

Config resolution: --file, else $YF_CONFIG, else ./yawningface.json
Templates: stress-free-mornings | freedom-afternoons | better-sleep-nights | social-detox
Coach env: YF_COACH_API_KEY (required - a free openrouter.ai key is enough),
           YF_COACH_BASE_URL, YF_COACH_MODEL - see .env.example

The coach is optional by design. The config is a JSON file you own; every
command works without any AI or any account.`;

interface Flags {
  file?: string;
  template?: string;
  once?: string;
  force?: boolean;
  apply?: boolean;
  help?: boolean;
  version?: boolean;
}

function parseArgs(argv: string[]): { command: string | undefined; flags: Flags } {
  const flags: Flags = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--file":
      case "-f":
      case "--out":
        flags.file = argv[++i];
        break;
      case "--template":
        flags.template = argv[++i];
        break;
      case "--once":
        flags.once = argv[++i] ?? "";
        break;
      case "--force":
        flags.force = true;
        break;
      case "--apply":
        flags.apply = true;
        break;
      case "--help":
      case "-h":
        flags.help = true;
        break;
      case "--version":
      case "-v":
        flags.version = true;
        break;
      default:
        positionals.push(arg);
    }
  }
  return { command: positionals[0], flags };
}

async function main(): Promise<number> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (flags.version) {
    console.log(VERSION);
    return 0;
  }
  if (flags.help || command === undefined || command === "help") {
    console.log(HELP);
    return command === undefined || command === "help" || flags.help ? 0 : 1;
  }

  loadDotEnv();

  switch (command) {
    case "init":
      return runInit(flags);
    case "show":
      return runShow(flags.file);
    case "validate":
      return runValidate(flags.file);
    case "coach":
      return runCoach(flags);
    default:
      console.error(`✗ unknown command "${command}"\n`);
      console.log(HELP);
      return 1;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`✗ ${(error as Error).message}`);
    process.exitCode = 1;
  },
);
