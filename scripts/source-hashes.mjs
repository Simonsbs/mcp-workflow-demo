import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
export async function sourceHashes() {
  const paths = [
    "src/domain.ts",
    "src/fixtures.ts",
    "src/export.ts",
    "src/client.ts",
    "src/App.tsx",
    "src/styles.css",
    "src/main.tsx",
    "server/service.ts",
    "server/mcp.ts",
    "server/routes.ts",
    "server/store.ts",
    "worker/index.ts",
    "worker/d1.ts",
    "worker/http.ts",
    "db/schema.ts",
    "package.json",
    "package-lock.json",
    "scripts/build.mjs",
    ...(await readdir("drizzle"))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => "drizzle/" + f),
  ];
  const result = {};
  for (const path of paths)
    result[path] = createHash("sha256")
      .update((await readFile(path, "utf8")).replace(/\r\n/g, "\n"))
      .digest("hex");
  return result;
}
export async function fingerprint() {
  return createHash("sha256")
    .update(JSON.stringify(await sourceHashes()))
    .digest("hex");
}
