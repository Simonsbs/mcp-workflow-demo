import { strToU8, zipSync } from "fflate";
import { verifyState, canonical } from "./domain.ts";
import type { State } from "./domain.ts";
const safe = (v: unknown) => {
  let value = String(v ?? "");
  if (/^[\s]*[=+@-]/.test(value)) value = "'" + value;
  return '"' + value.replaceAll('"', '""') + '"';
};
export function csv(headers: string[], rows: unknown[][]) {
  return (
    [headers, ...rows].map((r) => r.map(safe).join(",")).join("\r\n") + "\r\n"
  );
}
export async function evidenceFiles(state: State) {
  const verification = await verifyState(state);
  if (!verification.valid)
    throw new Error(
      "Export refused: audit or task bindings failed verification.",
    );
  return {
    "evidence.json": JSON.stringify(
      {
        application: "Workflow Lab",
        exportedAt: new Date().toISOString(),
        scope:
          "Synthetic records; deterministic runner; demo roles are not separate verified people.",
        verification,
        state,
      },
      null,
      2,
    ),
    "orders.csv": csv(
      ["orderId", "customer", "status", "version"],
      state.orders.map((o) => [o.id, o.customer, o.status, o.version]),
    ),
    "approvals.csv": csv(
      [
        "approvalId",
        "status",
        "actor",
        "resource",
        "payloadHash",
        "reason",
        "expiresAt",
      ],
      state.approvals.map((a) => [
        a.id,
        a.status,
        a.actor,
        a.resource,
        a.payloadHash,
        a.reason,
        a.expiresAt,
      ]),
    ),
    "tasks.csv": csv(
      [
        "taskId",
        "approvalId",
        "orderId",
        "orderVersion",
        "queue",
        "priority",
        "createdAt",
        "payloadHash",
      ],
      state.tasks.map((t) => [
        t.id,
        t.approvalId,
        t.payload.orderId,
        t.payload.orderVersion,
        t.payload.queue,
        t.payload.priority,
        t.createdAt,
        t.payloadHash,
      ]),
    ),
    "audit.ndjson": state.audit.map(canonical).join("\n") + "\n",
    "README.txt":
      "Workflow Lab evidence\nAll records are synthetic. No external task, email or customer contact was created.\nThe opaque capability keys and authorization headers are deliberately excluded.\nVerify evidence.json with: node --experimental-strip-types scripts/verify-evidence.mjs <path>\nA hash chain detects accidental or partial tampering. It is not a digital signature or independent attestation.\nApproval is a demo role switch in one visitor workspace, not verified identity or two-person control.\nThe guided runner is deterministic. No model inference, OAuth authorization server or production enterprise MCP certification is claimed.\n",
  };
}
export async function evidenceZip(state: State) {
  const files = await evidenceFiles(state);
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])),
    { level: 6 },
  );
}
