import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fingerprint } from "./source-hashes.mjs";
const origin = new URL(process.argv[2] ?? "https://workflow.bestdev.co.il")
    .origin,
  checks = [];
const expected = await fingerprint();
const response = await fetch(origin + "/", { redirect: "error" }),
  html = await response.text();
assert.equal(response.status, 200);
assert.match(html, /Workflow Lab/);
assert.ok(!html.includes("sign in"));
checks.push("Public HTML without sign-in");
assert.match(
  response.headers.get("content-security-policy"),
  /connect-src 'self'/,
);
assert.equal(response.headers.get("x-frame-options"), "DENY");
assert.equal(response.headers.get("x-content-type-options"), "nosniff");
checks.push("Response security headers");
for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)) {
  const r = await fetch(origin + match[1], { redirect: "error" });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /immutable/);
  assert.ok((await r.arrayBuffer()).byteLength > 0);
}
checks.push("Published JS and CSS assets");
const health = await (
  await fetch(origin + "/api/health", { redirect: "error" })
).json();
assert.equal(health.ready, true);
assert.equal(health.sourceFingerprint, expected);
checks.push("Ready SQL with exact local application fingerprint");
for (const name of ["README", "BUILD_NOTES", "CONTRACT", "VALIDATION"]) {
  const r = await fetch(origin + "/docs/" + name + ".md", {
    redirect: "error",
  });
  assert.equal(r.status, 200);
  assert.ok((await r.text()).length > 100);
}
checks.push("Published architecture, contract and validation docs");
assert.equal(
  (await fetch(origin + "/missing.svg", { redirect: "error" })).status,
  404,
);
assert.equal(
  (await fetch(origin + "/", { method: "POST", body: "x", redirect: "error" }))
    .status,
  405,
);
checks.push("Static route and method boundaries");
const report = {
  origin,
  at: new Date().toISOString(),
  passed: checks.length,
  checks,
  fingerprint: expected,
};
await mkdir("artifacts/validation", { recursive: true });
await writeFile(
  "artifacts/validation/smoke-" + new URL(origin).hostname + ".json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
