import { readFile } from "node:fs/promises";
import { verifyState } from "../src/domain.ts";
const file = process.argv[2];
if (!file)
  throw new Error(
    "Usage: node --experimental-strip-types scripts/verify-evidence.mjs <evidence.json>",
  );
const { state } = JSON.parse(await readFile(file, "utf8"));
const result = await verifyState(state);
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;
