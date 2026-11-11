import { Service } from "./service.ts";
import { handleMcp, toolDefinitions } from "./mcp.ts";
import { Problem, limits } from "../src/domain.ts";
import { metadata } from "../worker/assets.generated.ts";

export function resources(request: Request) {
  const url = new URL(request.url);
  const loopback = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    !loopback &&
    ![
      "workflow.bestdev.co.il",
      "simonsbs-workflow-lab.thefrik.chatgpt.site",
    ].includes(url.hostname)
  )
    throw new Problem("INVALID_HOST", "This host is not permitted.", 421);
  const base = loopback ? url.origin : "https://workflow.bestdev.co.il";
  return { mcp: base + "/api/mcp", review: base + "/api/review" };
}
export function guard(request: Request) {
  const url = new URL(request.url),
    origin = request.headers.get("origin");
  resources(request);
  if (origin && origin !== url.origin)
    throw new Problem(
      "INVALID_ORIGIN",
      "Cross-origin browser requests are not permitted.",
      403,
    );
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site")
    throw new Problem(
      "INVALID_ORIGIN",
      "Cross-site browser requests are not permitted.",
      403,
    );
}
export async function body(request: Request) {
  if (
    !(request.headers.get("content-type") ?? "")
      .toLowerCase()
      .startsWith("application/json")
  )
    throw new Problem("CONTENT_TYPE", "Use application/json.", 415);
  const text = await limitedText(request);
  try {
    return JSON.parse(text);
  } catch {
    throw new Problem("MALFORMED_JSON", "The request body is not valid JSON.");
  }
}
export async function limitedText(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > limits.maxBodyBytes)
    throw new Problem(
      "BODY_TOO_LARGE",
      "The maximum request body is 16 KiB.",
      413,
    );
  const reader = request.body?.getReader();
  if (!reader) return "";
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limits.maxBodyBytes) {
        await reader.cancel();
        throw new Problem(
          "BODY_TOO_LARGE",
          "The maximum request body is 16 KiB.",
          413,
        );
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Problem(
      "MALFORMED_JSON",
      "Request body must contain valid UTF-8.",
    );
  }
}
export async function route(
  request: Request,
  service: Service,
): Promise<Response> {
  guard(request);
  const url = new URL(request.url),
    resource = resources(request);
  if (
    url.pathname === "/api/health" &&
    ["GET", "HEAD"].includes(request.method)
  ) {
    await service.store.batch([
      { sql: "SELECT id FROM workspaces LIMIT 1", args: [] },
    ]);
    return new Response(
      request.method === "HEAD"
        ? null
        : JSON.stringify({
            ready: true,
            application: "Workflow Lab",
            schemaVersion: 1,
            protocol: "2026-07-28",
            ...metadata,
          }),
      { headers: { "Content-Type": "application/json" } },
    );
  }
  if (url.pathname === "/api/catalog" && request.method === "GET")
    return Response.json({
      tools: toolDefinitions,
      authentication:
        "Audience-bound opaque demo capabilities; manual SDK bearer setup. OAuth is not implemented.",
      runner: "deterministic",
      modelInference: false,
    });
  if (url.pathname === "/api/workspaces" && request.method === "POST") {
    const value = await body(request);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length
    )
      throw new Problem(
        "INVALID_ARGUMENT",
        "Workspace creation accepts an empty object only.",
      );
    return Response.json(await service.create(resource.mcp), { status: 201 });
  }
  if (url.pathname === "/api/mcp") {
    const p = await service.authenticate(
      request.headers.get("authorization"),
      resource.mcp,
    );
    return handleMcp(request, service, p);
  }
  if (url.pathname.startsWith("/api/review/")) {
    const p = await service.authenticate(
      request.headers.get("authorization"),
      resource.review,
    );
    if (url.pathname === "/api/review/state" && request.method === "GET")
      return Response.json(await service.snapshot(p));
    if (url.pathname === "/api/review/approvals" && request.method === "POST")
      return Response.json(
        await service.requestApproval(p, await body(request), resource.mcp),
        { status: 201 },
      );
    const match = url.pathname.match(
      /^\/api\/review\/approvals\/([a-f0-9-]{36})\/decision$/,
    );
    if (match && request.method === "POST")
      return Response.json(
        await service.decide(p, match[1], await body(request)),
      );
  }
  return Response.json(
    { error: { code: "NOT_FOUND", message: "No matching route and method." } },
    { status: 404 },
  );
}
