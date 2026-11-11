import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
const hosts = [
  "bestdev.co.il",
  "knowledge.bestdev.co.il",
  "integration.bestdev.co.il",
  "presales.bestdev.co.il",
  "traceability.bestdev.co.il",
];
const checks = await Promise.all(
  hosts.map(async (host) => {
    const r = await fetch("https://" + host + "/", { redirect: "error" });
    assert.equal(r.status, 200, host);
    return { host, status: r.status };
  }),
);
const report = {
  at: new Date().toISOString(),
  method: "Direct HTTPS, default certificate validation, no redirects",
  passed: checks.length,
  checks,
};
await mkdir("artifacts/validation", { recursive: true });
await writeFile(
  "artifacts/validation/existing-sites.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
