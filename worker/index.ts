import { assets, metadata } from "./assets.generated.ts";
import { D1Store } from "./d1.ts";
import { Service } from "../server/service.ts";
import { route } from "../server/routes.ts";
import { protect, failure } from "./http.ts";
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/health") {
        if (!["GET", "HEAD"].includes(request.method))
          return protect(new Response("Method not allowed", { status: 405 }));
        await env.DB.prepare("SELECT id FROM workspaces LIMIT 1").all();
        return protect(
          new Response(
            request.method === "HEAD"
              ? null
              : JSON.stringify({
                  ready: true,
                  application: "Workflow Lab",
                  schemaVersion: 1,
                  storage: "SQL-backed visitor workspace",
                  ...metadata,
                }),
            { headers: { "Content-Type": "application/json; charset=utf-8" } },
          ),
        );
      }
      if (url.pathname.startsWith("/api/"))
        return protect(await route(request, new Service(new D1Store(env.DB))));
      if (!["GET", "HEAD"].includes(request.method))
        return protect(
          new Response("Method not allowed", {
            status: 405,
            headers: { Allow: "GET, HEAD" },
          }),
        );
      const asset = assets[url.pathname === "/" ? "/index.html" : url.pathname];
      if (!asset) return protect(new Response("Not found", { status: 404 }));
      return protect(
        new Response(
          request.method === "HEAD"
            ? null
            : Uint8Array.from(atob(asset.body), (c) => c.charCodeAt(0)),
          {
            headers: {
              "Content-Type": asset.type,
              "Cache-Control": url.pathname.startsWith("/assets/")
                ? "public, max-age=31536000, immutable"
                : "no-cache",
            },
          },
        ),
      );
    } catch (error) {
      return protect(failure(error));
    }
  },
};
