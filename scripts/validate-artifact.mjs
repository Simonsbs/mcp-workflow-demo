import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const manifest = JSON.parse(
  await readFile("dist/.openai/hosting.json", "utf8"),
);
assert.ok(manifest.project_id);
assert.equal(manifest.d1, "DB");
assert.ok(!manifest.static && !manifest.r2);
assert.deepEqual((await readdir("dist")).sort(), [".openai", "server"]);
const { default: worker } = await import(
  pathToFileURL(resolve("dist/server/index.js")).href + "?v=" + Date.now()
);
const r = await worker.fetch(new Request("https://lab.invalid/"), {}),
  html = await r.text();
assert.equal(r.status, 200);
assert.match(html, /Workflow Lab/);
assert.match(r.headers.get("content-security-policy"), /connect-src 'self'/);
assert.equal(r.headers.get("x-frame-options"), "DENY");
assert.match(r.headers.get("cache-control"), /no-cache/);
const paths = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(
  (m) => m[1],
);
assert.ok(paths.length >= 2);
for (const path of paths) {
  const r = await worker.fetch(new Request("https://lab.invalid" + path), {});
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /immutable/);
  assert.ok((await r.arrayBuffer()).byteLength > 0);
}
for (const path of [
  "/docs/README.md",
  "/docs/BUILD_NOTES.md",
  "/docs/CONTRACT.md",
  "/docs/VALIDATION.md",
  "/favicon.svg",
])
  assert.equal(
    (await worker.fetch(new Request("https://lab.invalid" + path), {})).status,
    200,
  );
assert.equal(
  (await worker.fetch(new Request("https://lab.invalid/missing.svg"), {}))
    .status,
  404,
);
assert.equal(
  (
    await worker.fetch(
      new Request("https://lab.invalid/", { method: "POST", body: "x" }),
      {},
    )
  ).status,
  405,
);
assert.equal(
  await (
    await worker.fetch(
      new Request("https://lab.invalid/", { method: "HEAD" }),
      {},
    )
  ).text(),
  "",
);
console.log(
  "PASS: compiled Worker application, assets, documentation, security/cache headers and static route boundaries.",
);
