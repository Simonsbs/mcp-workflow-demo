import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { verifyState } from "../src/domain.ts";
const source = process.argv[2],
  output = resolve(process.argv[3] ?? "artifacts/validation/browser-download");
const root = resolve("artifacts");
const rel = relative(root, output);
assert.ok(
  !rel.startsWith("..") && !isAbsolute(rel),
  "Output must stay inside this project's artifacts folder.",
);
const files = unzipSync(await readFile(source));
assert.deepEqual(Object.keys(files).sort(), [
  "README.txt",
  "approvals.csv",
  "audit.ndjson",
  "evidence.json",
  "orders.csv",
  "tasks.csv",
]);
const evidence = JSON.parse(strFromU8(files["evidence.json"]));
const verification = await verifyState(evidence.state);
assert.equal(verification.valid, true);
const text = Object.values(files).map(strFromU8).join("\n");
assert.ok(!/wfl_[a-f0-9]{64}/.test(text));
await mkdir(output, { recursive: true });
for (const [name, value] of Object.entries(files))
  await writeFile(resolve(output, name), value);
const report = {
  at: new Date().toISOString(),
  source,
  files: Object.keys(files),
  tasks: evidence.state.tasks.length,
  proposals: evidence.state.approvals.length,
  auditEvents: evidence.state.audit.length,
  verification,
  credentialsExcluded: true,
};
await writeFile(
  resolve(output, "download-validation.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
