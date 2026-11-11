# Workflow Lab

An independent MCP integration and controlled workflow demonstrator by Simon Stirling. Public demo: https://workflow.bestdev.co.il/. All operational records are synthetic.

The official MCP TypeScript SDK 2.4 client talks to a real SDK server over Streamable HTTP. A deterministic investigator reads an order and integration errors, then proposes a task. A separate review capability records explicit approval or rejection. Only `create_followup` can create an operational task. It checks the exact payload digest, workspace, actor, resource, source version, expiry and decision before an atomic, replay-safe commit.

No model inference, external messages, production customer deployment, verified two-person control or OAuth authorization server is claimed.

## Run locally

Node 24.12 or newer. Run `npm ci`, then `npm run dev:api` and `npm run dev` in separate terminals. Open http://127.0.0.1:5178/. SQLite data stays in ignored `.runtime/workflow.sqlite`. A fresh synthetic workspace is generated per browser and expires after 24 hours. Browser capability keys stay on that browser; the server stores SHA-256 token hashes only. Do not put real data into the demo.

`npm run check`, `npm test`, `npm run build` and `npm run verify:local` validate types, domain/security behaviour, the built Worker, real HTTP interoperability and SQLite/D1 restart persistence. `npm run smoke -- <public-origin>` checks public hosting. See [VALIDATION.md](VALIDATION.md).

## Five-minute demonstration

1. Investigate ORD-2048. Inspect the order, source errors and captured MCP request/response bodies.
2. Inspect the exact deterministic task payload and send it for approval.
3. Attempt execution while pending. Observe the server denial. Try a controller approval attempt to see the separate scope boundary.
4. Switch the demo review capability, enter a reason and approve the exact task. Execute the MCP call. Replay it and confirm the same task is returned.
5. Run the live security probes. Investigate ORD-2057 to inspect the untrusted prompt-injection fixture. Download the six-file evidence ZIP and verify `evidence.json` with `scripts/verify-evidence.mjs`.

Architecture and limitations: [BUILD_NOTES.md](BUILD_NOTES.md). Protocol and API contract: [CONTRACT.md](CONTRACT.md). This repository and deployable Worker have their own identity and are independent of the portfolio site.
