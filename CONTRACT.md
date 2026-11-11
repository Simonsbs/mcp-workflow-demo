# MCP and review contract

## Public MCP endpoint

`POST https://workflow.bestdev.co.il/api/mcp`, JSON-RPC 2.0 over MCP Streamable HTTP. Modern protocol `2026-07-28` is negotiated with `server/discover` by the official SDK auto mode. Stateless legacy `initialize` clients are also supported by the SDK handler. There is no server session or long-lived subscription. GET and DELETE session operations return 405 after authentication.

The endpoint accepts manually issued demo bearer capabilities. This is not an OAuth service. Audience is `https://workflow.bestdev.co.il/api/mcp` on both public host aliases. Local loopback uses its own origin. Review tokens have the distinct `/api/review` audience. The wrong-audience diagnostic token is for `/api/unrelated-resource` and is intentionally rejected by MCP. No token passthrough.

| Tool              | Strict input                               | Scope        | Effect                                               |
| ----------------- | ------------------------------------------ | ------------ | ---------------------------------------------------- |
| lookup_order      | orderId                                    | orders:read  | Synthetic order lookup                               |
| get_error_history | orderId                                    | errors:read  | Untrusted external error data                        |
| draft_followup    | orderId, priority: normal or high          | tasks:draft  | Deterministic proposal only                          |
| create_followup   | approvalId: UUID, payloadHash: SHA-256 hex | tasks:create | One approved synthetic task; replay returns existing |

Each tool returns both text JSON and structured content. Domain denials use `isError:true` and `{error:{code,message}}`. Protocol/schema errors use SDK JSON-RPC responses. Missing/unknown bearer, expiry and audience failures return HTTP 401 with a Bearer challenge. Tool annotations are descriptive hints and do not grant authority.

## Review API

`POST /api/workspaces` with `{}` creates a bounded synthetic workspace and five demo capability keys. Preserve them privately in the caller; never place keys in URLs or commit them. `GET /api/review/state` requires workspace:read. `POST /api/review/approvals` requires approval:request and `{payload,payloadHash}`. The server regenerates and compares the full task template. `POST /api/review/approvals/{id}/decision` requires approval:decide and `{decision:"approved"|"rejected",reason:"5 to 300 characters"}`. No MCP tool exposes these decision operations.

The controller has workspace:read and approval:request; the reviewer has workspace:read and approval:decide. The executor has all read/draft scopes plus tasks:create. One browser owns all demo roles, explicitly labelled as simulation.

## External SDK use

Use `scripts/external-client.mjs <origin>` to create a disposable synthetic workspace, negotiate with the official SDK, list tools, read an order and demonstrate approval bypass rejection. It keeps credentials only in process memory and prints redacted results. Do not paste demo keys into public clients, screenshots or issues. It does not automatically approve or execute a task.
