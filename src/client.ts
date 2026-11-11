import type { Client } from "@modelcontextprotocol/client";
import type { Session, State, Approval, TaskPayload } from "./domain.ts";
import { payloadHash, Problem } from "./domain.ts";
export type Wire = {
  id: string;
  method: string;
  status: number;
  durationMs: number;
  request: unknown;
  response: unknown;
  transport: string;
};
export type Snapshot = {
  state: State;
  revision: number;
  verification: { valid: boolean; checks: number; errors: string[] };
};
export async function rest<T>(
  path: string,
  key?: string,
  value?: unknown,
): Promise<T> {
  const r = await fetch(path, {
    method: value === undefined ? "GET" : "POST",
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(value === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: value === undefined ? undefined : JSON.stringify(value),
    redirect: "error",
  });
  const body = (await r.json()) as {
    error?: { code?: string; message?: string };
  };
  if (!r.ok)
    throw new Problem(
      body.error?.code ?? "HTTP_ERROR",
      body.error?.message ?? `Request failed (${r.status}).`,
      r.status,
    );
  return body as T;
}
export const createSession = () =>
  rest<Session>("/api/workspaces", undefined, {});
export const getSnapshot = (s: Session) =>
  rest<Snapshot>("/api/review/state", s.credentials.controller);
export const requestApproval = async (s: Session, payload: TaskPayload) =>
  rest<Approval>("/api/review/approvals", s.credentials.controller, {
    payload,
    payloadHash: await payloadHash(payload),
  });
export const decideApproval = (
  s: Session,
  id: string,
  decision: "approved" | "rejected",
  reason: string,
  role: "controller" | "reviewer",
) =>
  rest<Approval>(`/api/review/approvals/${id}/decision`, s.credentials[role], {
    decision,
    reason,
  });
export async function mcpSession<T>(
  s: Session,
  kind: "reader" | "agent" | "wrong-audience",
  operation: (client: Client) => Promise<T>,
  onWire: (wire: Wire) => void = () => {},
) {
  const { Client: McpClient, StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/client");
  const client = new McpClient(
    { name: "workflow-lab-guided-client", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL("/api/mcp", location.origin),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${s.credentials[kind]}` },
        redirect: "error",
      },
      fetch: async (input, init) => {
        const start = performance.now();
        const request =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        const r = await fetch(input, init);
        let response: unknown;
        const text = await r.clone().text();
        try {
          response = JSON.parse(text);
        } catch {
          response = text.slice(0, 4000);
        }
        // Only protocol bodies are captured. Authorization headers never enter UI traces.
        onWire({
          id: crypto.randomUUID(),
          method: request.method ?? "transport",
          status: r.status,
          durationMs: Math.round(performance.now() - start),
          request,
          response,
          transport: "MCP Streamable HTTP / official TypeScript SDK 2.4",
        });
        return r;
      },
    },
  );
  try {
    await client.connect(transport);
    return await operation(client);
  } finally {
    await client.close();
  }
}
export function toolValue<T>(result: unknown): T {
  const r = result as {
    isError?: boolean;
    structuredContent?: { error?: { code: string; message: string } };
    content?: Array<{ type: string; text?: string }>;
  };
  const text = r.content?.find((c) => c.type === "text")?.text ?? "{}";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (r.isError) throw new Problem("TOOL_INPUT_VALIDATION", text);
    throw new Error("The tool returned invalid JSON content.");
  }
  const value = r.structuredContent ?? parsed;
  if (r.isError)
    throw new Problem(
      value.error?.code ?? "TOOL_ERROR",
      value.error?.message ?? "Tool request was denied.",
    );
  return value as T;
}
