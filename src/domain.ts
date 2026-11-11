import { z } from "zod";

export class Problem extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export const orderIdSchema = z.string().regex(/^ORD-20(48|51|57)$/);
export const prioritySchema = z.enum(["normal", "high"]);
export const draftSchema = z
  .object({ orderId: orderIdSchema, priority: prioritySchema })
  .strict();
export const taskSchema = z
  .object({
    orderId: orderIdSchema,
    orderVersion: z.number().int().positive(),
    queue: z.literal("demo-integration-followup"),
    title: z.string().min(1).max(140),
    body: z.string().min(1).max(1500),
    priority: prioritySchema,
    evidence: z
      .array(z.string().regex(/^ERR-\d{3}$/))
      .min(1)
      .max(6),
  })
  .strict();
export type TaskPayload = z.infer<typeof taskSchema>;
export const executeSchema = z
  .object({
    approvalId: z.string().uuid(),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type Order = {
  id: string;
  customer: string;
  item: string;
  total: number;
  currency: string;
  status: "needs-attention" | "healthy";
  version: number;
  updatedAt: string;
};
export type ErrorEvent = {
  id: string;
  orderId: string;
  at: string;
  code: string;
  message: string;
  source: string;
  trust: "untrusted-external-data";
  injectionFixture: boolean;
};
export type Approval = {
  id: string;
  workspaceId: string;
  actor: string;
  resource: string;
  payload: TaskPayload;
  payloadHash: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "approved" | "rejected" | "consumed";
  decidedAt?: string;
  decidedBy?: string;
  reason?: string;
  taskId?: string;
};
export type Task = {
  id: string;
  approvalId: string;
  workspaceId: string;
  actor: string;
  payloadHash: string;
  payload: TaskPayload;
  createdAt: string;
};
export type AuditEvent = {
  sequence: number;
  id: string;
  at: string;
  actor: string;
  action: string;
  outcome: "allowed" | "denied";
  code: string;
  details: Record<string, unknown>;
  previousHash: string;
  hash: string;
};
export type State = {
  schemaVersion: 1;
  workspaceId: string;
  createdAt: string;
  expiresAt: string;
  orders: Order[];
  errors: ErrorEvent[];
  approvals: Approval[];
  tasks: Task[];
  audit: AuditEvent[];
};
export type Principal = {
  workspaceId: string;
  subject: string;
  kind: "reader" | "agent" | "controller" | "reviewer" | "wrong-audience";
  audience: string;
  scopes: string[];
  expiresAt: string;
};
export type Credentials = Record<Principal["kind"], string>;
export type Session = {
  workspaceId: string;
  expiresAt: string;
  resource: string;
  credentials: Credentials;
};
export const limits = {
  workspaceHours: 24,
  approvalMinutes: 10,
  maxEvents: 300,
  maxApprovals: 20,
  maxTasks: 10,
  maxActive: 200,
  creationPerMinute: 20,
  maxBodyBytes: 16_384,
};
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",") +
    "}"
  );
}
export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export const payloadHash = (payload: TaskPayload) => sha256(canonical(payload));
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new Problem(
      "INVALID_ARGUMENT",
      "Arguments do not match the declared schema.",
    );
  return result.data;
}
export function requireScope(p: Principal, scope: string) {
  if (!p.scopes.includes(scope))
    throw new Problem(
      "INSUFFICIENT_SCOPE",
      `This capability does not grant ${scope}.`,
      403,
    );
}
export function assertOrder(state: State, id: string) {
  const order = state.orders.find((o) => o.id === id);
  if (!order)
    throw new Problem(
      "ORDER_NOT_FOUND",
      "Order is not in this workspace.",
      404,
    );
  return order;
}
export function draftTask(
  state: State,
  orderId: string,
  priority: "normal" | "high",
): TaskPayload {
  const order = assertOrder(state, orderId),
    errors = state.errors.filter((e) => e.orderId === orderId);
  if (order.status !== "needs-attention" || !errors.length)
    throw new Problem(
      "NO_FOLLOWUP_NEEDED",
      "This synthetic order has no actionable error.",
      409,
    );
  // Only allowlisted identifiers and error codes enter the deterministic template.
  // Raw partner text is displayed as evidence, never parsed as an instruction.
  return {
    orderId,
    orderVersion: order.version,
    queue: "demo-integration-followup",
    title: `Investigate delivery issue for ${orderId}`,
    body: `Review ${errors.map((e) => e.code).join(", ")} for ${orderId}. Confirm the integration state before any retry. This task does not retry, contact a customer or change an external system.`,
    priority,
    evidence: errors.map((e) => e.id),
  };
}
export async function appendAudit(
  state: State,
  at: string,
  actor: string,
  action: string,
  outcome: AuditEvent["outcome"],
  code: string,
  details: Record<string, unknown>,
) {
  if (state.audit.length >= limits.maxEvents)
    throw new Problem(
      "WORKSPACE_LIMIT",
      "The 300-event demo limit has been reached. Start a new workspace.",
      429,
    );
  const event = {
    sequence: state.audit.length + 1,
    id: crypto.randomUUID(),
    at,
    actor,
    action,
    outcome,
    code,
    details,
    previousHash: state.audit.at(-1)?.hash ?? "0".repeat(64),
  };
  state.audit.push({ ...event, hash: await sha256(canonical(event)) });
}
export async function verifyState(
  state: State,
): Promise<{ valid: boolean; checks: number; errors: string[] }> {
  const errors: string[] = [];
  let checks = 0,
    previous = "0".repeat(64);
  const check = (ok: boolean, message: string) => {
    checks++;
    if (!ok) errors.push(message);
  };
  check(state.schemaVersion === 1, "Unsupported schema");
  for (const [i, event] of state.audit.entries()) {
    const { hash, ...data } = event;
    check(
      event.sequence === i + 1 &&
        event.previousHash === previous &&
        hash === (await sha256(canonical(data))),
      `Broken audit event ${i + 1}`,
    );
    previous = hash;
  }
  const requests = state.audit.filter(
    (e) => e.action === "approval.request" && e.outcome === "allowed",
  );
  const consumed = state.audit.filter(
    (e) => e.action === "create_followup" && e.code === "TASK_CREATED",
  );
  check(
    requests.length === state.approvals.length,
    "Approval count differs from audit",
  );
  check(
    consumed.length === state.tasks.length,
    "Task count differs from audit",
  );
  check(
    new Set(state.tasks.map((t) => t.approvalId)).size === state.tasks.length,
    "Duplicate task for approval",
  );
  for (const a of state.approvals) {
    check(
      taskSchema.safeParse(a.payload).success &&
        a.payloadHash === (await payloadHash(a.payload)),
      `Approval digest ${a.id}`,
    );
    const requested = requests.find((e) => e.details.approvalId === a.id);
    check(
      a.workspaceId === state.workspaceId &&
        requested?.details.payloadHash === a.payloadHash &&
        canonical(requested?.details.payload) === canonical(a.payload) &&
        requested?.details.actor === a.actor &&
        requested?.details.resource === a.resource,
      `Approval binding ${a.id}`,
    );
    const decision = state.audit.find(
      (e) =>
        e.action === "approval.decide" &&
        e.outcome === "allowed" &&
        e.details.approvalId === a.id,
    );
    check(
      a.status === "pending"
        ? !decision
        : !!decision &&
            decision.actor === a.decidedBy &&
            decision.at === a.decidedAt &&
            decision.details.reason === a.reason &&
            decision.details.decision ===
              (a.status === "rejected" ? "rejected" : "approved"),
      `Approval decision ${a.id}`,
    );
    check(
      a.status !== "consumed" ||
        state.tasks.some((t) => t.id === a.taskId && t.approvalId === a.id),
      `Consumed approval without task ${a.id}`,
    );
  }
  for (const t of state.tasks) {
    const a = state.approvals.find((x) => x.id === t.approvalId),
      event = consumed.find((e) => e.details.taskId === t.id);
    check(
      !!a &&
        a.status === "consumed" &&
        a.taskId === t.id &&
        a.actor === t.actor &&
        a.workspaceId === t.workspaceId &&
        t.workspaceId === state.workspaceId &&
        a.payloadHash === t.payloadHash &&
        t.payloadHash === (await payloadHash(t.payload)) &&
        canonical(a.payload) === canonical(t.payload),
      `Task binding ${t.id}`,
    );
    check(
      !!a &&
        !!a.decidedAt &&
        a.decidedAt <= t.createdAt &&
        t.createdAt < a.expiresAt &&
        event?.at === t.createdAt &&
        event.actor === t.actor &&
        canonical(event.details.task) === canonical(t),
      `Task evidence ${t.id}`,
    );
  }
  for (const o of state.orders)
    check(
      o.version ===
        1 + state.tasks.filter((t) => t.payload.orderId === o.id).length,
      `Order revision ${o.id}`,
    );
  return { valid: errors.length === 0, checks, errors };
}
