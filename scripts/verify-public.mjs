import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { httpSuite, resumeCheckpoint } from "./http-suite.mjs";
const origin = new URL(process.argv[2] ?? "https://workflow.bestdev.co.il")
  .origin;
await mkdir("artifacts/validation", { recursive: true });
try {
  const { report, checkpoint } = await httpSuite(origin);
  const name = new URL(origin).hostname;
  await writeFile(
    `artifacts/validation/http-${name}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(
    `PASS public ${name}: ${report.passed} scenarios / ${report.requests} requests.`,
  );
  if (process.argv.includes("--checkpoint")) {
    console.log(
      "PUBLIC_CHECKPOINT_READY: capabilities held only in process memory. Enter verify after deployment.",
    );
    const input = createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });
    for await (const line of input) {
      if (line.trim() !== "verify") continue;
      const result = await resumeCheckpoint(origin, checkpoint);
      await writeFile(
        "artifacts/validation/public-deployment-retention.json",
        JSON.stringify(result, null, 2),
      );
      console.log(JSON.stringify(result));
      input.close();
      break;
    }
  }
} catch (e) {
  await writeFile(
    `artifacts/validation/public-failure-${Date.now()}.json`,
    JSON.stringify(e.validation ?? { error: e.message }, null, 2),
  );
  throw e;
}
