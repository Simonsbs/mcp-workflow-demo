import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { httpSuite, resumeCheckpoint } from "./http-suite.mjs";
const at = process.argv.indexOf("--output"),
  out = resolve(at < 0 ? "artifacts/validation" : process.argv[at + 1]);
await mkdir(out, { recursive: true });
const runId = Date.now() + "-" + process.pid,
  sqlite = resolve(out, `runtime-${runId}.sqlite`),
  d1 = resolve(out, `d1-${runId}`);
const children = new Set();
async function child(args, env = {}) {
  const p = spawn(process.execPath, args, {
    env: { ...process.env, ...env },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(p);
  let log = "";
  p.stdout.on("data", (v) => (log += v));
  p.stderr.on("data", (v) => (log += v));
  return { p, log: () => log };
}
async function stop(c) {
  if (!children.has(c.p)) return;
  if (process.platform === "win32")
    await new Promise((done) => {
      const p = spawn("taskkill", ["/PID", String(c.p.pid), "/T", "/F"], {
        stdio: "ignore",
      });
      p.once("exit", done);
    });
  else {
    try {
      process.kill(-c.p.pid, "SIGTERM");
    } catch {}
  }
  children.delete(c.p);
  await delay(500);
}
async function command(args, name) {
  const c = await child(args);
  const code = await new Promise((r) => c.p.once("exit", r));
  children.delete(c.p);
  await writeFile(resolve(out, name + ".log"), c.log());
  if (code !== 0)
    throw new Error(`${name} failed (${code}). See retained log.`);
}
async function ready(origin, c) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(origin + "/api/health");
      if (r.ok) return;
    } catch {}
    if (c.p.exitCode !== null)
      throw new Error(
        "Server exited before readiness: " + c.log().slice(-1200),
      );
    await delay(200);
  }
  throw new Error("Server readiness timeout: " + c.log().slice(-1200));
}
const wrangler = "node_modules/wrangler/bin/wrangler.js";
const reports = [];
try {
  await command(
    [
      wrangler,
      "d1",
      "migrations",
      "apply",
      "workflow-local",
      "--local",
      "--persist-to",
      d1,
    ],
    "d1-migrations",
  );
  for (const target of [
    {
      name: "sqlite",
      origin: "http://127.0.0.1:8797",
      args: [
        "--experimental-strip-types",
        "server/local.mjs",
        "--port",
        "8797",
      ],
      env: { WORKFLOW_DB: sqlite },
    },
    {
      name: "worker-d1",
      origin: "http://127.0.0.1:8798",
      args: [
        wrangler,
        "dev",
        "dist/server/index.js",
        "--port",
        "8798",
        "--ip",
        "127.0.0.1",
        "--local",
        "--persist-to",
        d1,
      ],
    },
  ]) {
    let c = await child(target.args, target.env);
    await ready(target.origin, c);
    try {
      const { report, checkpoint } = await httpSuite(target.origin);
      await writeFile(
        resolve(out, target.name + "-http.json"),
        JSON.stringify(report, null, 2),
      );
      await stop(c);
      await writeFile(resolve(out, target.name + ".log"), c.log());
      c = await child(target.args, target.env);
      await ready(target.origin, c);
      const persistence = await resumeCheckpoint(target.origin, checkpoint);
      await writeFile(
        resolve(out, target.name + "-restart.json"),
        JSON.stringify(persistence, null, 2),
      );
      reports.push({
        target: target.name,
        passed: report.passed,
        requests: report.requests,
        persistence: true,
      });
      console.log(
        `PASS ${target.name}: ${report.passed} HTTP scenarios / ${report.requests} requests, restart state and capability preserved.`,
      );
    } finally {
      await stop(c);
      await writeFile(resolve(out, target.name + "-last.log"), c.log());
    }
  }
  await writeFile(
    resolve(out, "summary.json"),
    JSON.stringify({ at: new Date().toISOString(), reports }, null, 2),
  );
} catch (e) {
  await writeFile(
    resolve(out, "failure-" + runId + ".json"),
    JSON.stringify(e.validation ?? { error: e.message }, null, 2),
  );
  throw e;
} finally {
  for (const p of [...children]) await stop({ p });
}
