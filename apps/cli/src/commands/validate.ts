import { validateConfigStrict } from "@yawningface/schema";
import { readConfig, resolveConfigPath } from "../util.js";

export function runValidate(fileFlag: string | undefined): number {
  const path = resolveConfigPath(fileFlag);
  let config;
  try {
    config = readConfig(path);
  } catch (error) {
    console.error(`✗ ${(error as Error).message}`);
    return 1;
  }
  const problems = validateConfigStrict(config);
  if (problems.length > 0) {
    console.error(`✗ ${path} has ${problems.length} problem(s):`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    return 1;
  }
  console.log(`✓ ${path} is a valid YawningFace config (${config.blocklists.length} blocklist(s))`);
  return 0;
}
