import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { sqliteStore } from "./sqlite.mjs";
import { Service } from "./service.ts";
import { route } from "./routes.ts";
import { protect, failure } from "../worker/http.ts";
const at = process.argv.indexOf("--port"),
  port = Number(at < 0 ? 8790 : process.argv[at + 1]);
const databasePath = resolve(
  process.env.WORKFLOW_DB ?? ".runtime/workflow.sqlite",
);
await mkdir(dirname(databasePath), { recursive: true });
const store = await sqliteStore(databasePath),
  service = new Service(store);
const server = createServer(async (req, res) => {
  try {
    const url = `http://${req.headers.host ?? `127.0.0.1:${port}`}${req.url}`,
      headers = new Headers();
    for (const [k, v] of Object.entries(req.headers))
      if (v) headers.set(k, Array.isArray(v) ? v.join(",") : v);
    const init = { method: req.method, headers };
    if (!["GET", "HEAD"].includes(req.method)) {
      init.body = req;
      init.duplex = "half";
    }
    const request = new Request(url, init);
    const response = protect(await route(request, service));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    const response = protect(failure(error));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Workflow SQL API http://127.0.0.1:${port} (${databasePath})`),
);
process.on("SIGINT", () =>
  server.close(() => {
    store.close();
    process.exit(0);
  }),
);
process.on("SIGTERM", () =>
  server.close(() => {
    store.close();
    process.exit(0);
  }),
);
