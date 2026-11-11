import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
const origin = new URL(process.argv[2] ?? "http://127.0.0.1:8790").origin;
const response = await fetch(origin + "/api/workspaces", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
  redirect: "error",
});
if (!response.ok)
  throw new Error(`Workspace creation failed (${response.status}).`);
const session = await response.json();
const client = new Client(
  { name: "workflow-external-example", version: "1.0.0" },
  { versionNegotiation: { mode: "auto" } },
);
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(origin + "/api/mcp"), {
      requestInit: {
        headers: { Authorization: "Bearer " + session.credentials.agent },
        redirect: "error",
      },
    }),
  );
  const tools = await client.listTools();
  const order = await client.callTool({
    name: "lookup_order",
    arguments: { orderId: "ORD-2048" },
  });
  const bypass = await client.callTool({
    name: "create_followup",
    arguments: { approvalId: crypto.randomUUID(), payloadHash: "0".repeat(64) },
  });
  console.log(
    JSON.stringify(
      {
        protocol: client.getDiscoverResult() ? "2026-07-28" : "legacy",
        tools: tools.tools.map((t) => t.name),
        order: order.structuredContent,
        deniedWrite: bypass.structuredContent,
        keys: "kept in process memory; never printed",
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
