import { z } from "zod";
import {
  Problem,
  limits,
  parse,
  sha256,
  payloadHash,
  canonical,
  requireScope,
  assertOrder,
  draftTask,
  appendAudit,
  verifyState,
  draftSchema,
  executeSchema,
  taskSchema,
} from "../src/domain.ts";
import type {
  State,
  Principal,
  Session,
  Credentials,
  TaskPayload,
  Approval,
} from "../src/domain.ts";
import type { Store, Sql } from "./store.ts";
import { initialState } from "../src/fixtures.ts";

export class Service {
  store: Store;
  clock: () => number;
  constructor(store: Store, clock: () => number = Date.now) {
    this.store = store;
    this.clock = clock;
  }
  now() {
    return new Date(this.clock()).toISOString();
  }
  async create(resource: string): Promise<Session> {
    const now = this.now(),
      workspaceId = crypto.randomUUID(),
      expiresAt = new Date(
        this.clock() + limits.workspaceHours * 3600_000,
      ).toISOString();
    const state = initialState(workspaceId, now, expiresAt),
      credentials = {} as Credentials;
    await appendAudit(
      state,
      now,
      "visitor",
      "workspace.create",
      "allowed",
      "WORKSPACE_CREATED",
      { resource, synthetic: true },
    );
    const statements: Sql[] = [
      { sql: "DELETE FROM workspaces WHERE expires_at <= ?", args: [now] },
      {
        sql: "INSERT INTO workspaces(id,created_at,expires_at,revision,state) SELECT ?,?,?,0,? WHERE (SELECT count(*) FROM workspaces)< ? AND (SELECT count(*) FROM workspaces WHERE created_at > ?) < ?",
        args: [
          workspaceId,
          now,
          expiresAt,
          JSON.stringify(state),
          limits.maxActive,
          new Date(this.clock() - 60_000).toISOString(),
          limits.creationPerMinute,
        ],
      },
    ];
    const definitions: Array<[Principal["kind"], string, string, string[]]> = [
      [
        "reader",
        "demo-reader",
        resource,
        ["orders:read", "errors:read", "tasks:draft"],
      ],
      [
        "agent",
        "demo-agent",
        resource,
        ["orders:read", "errors:read", "tasks:draft", "tasks:create"],
      ],
      [
        "controller",
        "demo-controller",
        resource.replace(/\/mcp$/, "/review"),
        ["workspace:read", "approval:request"],
      ],
      [
        "reviewer",
        "demo-reviewer",
        resource.replace(/\/mcp$/, "/review"),
        ["workspace:read", "approval:decide"],
      ],
      [
        "wrong-audience",
        "demo-audience-probe",
        resource.replace(/\/mcp$/, "/unrelated-resource"),
        ["orders:read", "errors:read", "tasks:draft", "tasks:create"],
      ],
    ];
    for (const [kind, subject, audience, scopes] of definitions) {
      const key = `wfl_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
      credentials[kind] = key;
      const principal: Principal = {
        workspaceId,
        subject,
        kind,
        audience,
        scopes,
        expiresAt,
      };
      statements.push({
        sql: "INSERT INTO tokens(hash,workspace_id,principal) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM workspaces WHERE id=?)",
        args: [
          await sha256(key),
          workspaceId,
          JSON.stringify(principal),
          workspaceId,
        ],
      });
    }
    const result = await this.store.batch(statements);
    if (result[1].changes !== 1)
      throw new Problem(
        "CREATION_LIMIT",
        "The public demo workspace limit has been reached. Try again in a minute.",
        429,
      );
    return { workspaceId, expiresAt, resource, credentials };
  }
  async authenticate(
    authorization: string | null,
    audience: string,
  ): Promise<Principal> {
    if (!authorization?.match(/^Bearer wfl_[a-f0-9]{64}$/))
      throw new Problem(
        "UNAUTHORIZED",
        "A valid workspace bearer capability is required.",
        401,
      );
    const [{ rows }] = await this.store.batch([
      {
        sql: "SELECT principal FROM tokens WHERE hash=?",
        args: [await sha256(authorization.slice(7))],
      },
    ]);
    if (!rows.length)
      throw new Problem("UNAUTHORIZED", "Unknown workspace capability.", 401);
    const principal = JSON.parse(String(rows[0].principal)) as Principal;
    if (principal.expiresAt <= this.now())
      throw new Problem(
        "EXPIRED_TOKEN",
        "This 24-hour workspace has expired. Start a new workspace.",
        401,
      );
    if (principal.audience !== audience) {
      await this.mutate(principal, "auth.audience", () => {
        throw new Problem(
          "WRONG_AUDIENCE",
          "This token belongs to a different resource.",
          401,
        );
      }).catch(() => {});
      throw new Problem(
        "WRONG_AUDIENCE",
        "This token belongs to a different resource.",
        401,
      );
    }
    return principal;
  }
  async load(id: string): Promise<{ state: State; revision: number }> {
    const [{ rows }] = await this.store.batch([
      {
        sql: "SELECT state,revision,expires_at FROM workspaces WHERE id=?",
        args: [id],
      },
    ]);
    if (!rows.length || String(rows[0].expires_at) <= this.now())
      throw new Problem(
        "WORKSPACE_EXPIRED",
        "Workspace is unavailable or expired. Start a new workspace.",
        410,
      );
    return {
      state: JSON.parse(String(rows[0].state)) as State,
      revision: Number(rows[0].revision),
    };
  }
  async mutate<T>(
    p: Principal,
    action: string,
    fn: (
      s: State,
      now: string,
    ) => { value: T; code: string; details?: Record<string, unknown> },
  ): Promise<T> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { state, revision } = await this.load(p.workspaceId),
        now = this.now();
      let result:
          | { value: T; code: string; details?: Record<string, unknown> }
          | undefined,
        denied: Problem | undefined;
      try {
        result = fn(state, now);
      } catch (error) {
        if (!(error instanceof Problem)) throw error;
        denied = error;
      }
      // Mutations must validate before changing data. Failed operations are recorded
      // against a fresh copy, so a later validation failure cannot leak partial state.
      const next = denied
        ? await this.load(p.workspaceId)
        : { state, revision };
      if (denied && next.revision !== revision) continue;
      await appendAudit(
        next.state,
        now,
        p.subject,
        action,
        denied ? "denied" : "allowed",
        denied?.code ?? result!.code,
        denied ? {} : (result?.details ?? {}),
      );
      const [saved] = await this.store.batch([
        {
          sql: "UPDATE workspaces SET state=?,revision=revision+1 WHERE id=? AND revision=? AND expires_at>?",
          args: [JSON.stringify(next.state), p.workspaceId, revision, now],
        },
      ]);
      if (!saved.changes) continue;
      if (denied) throw denied;
      return result!.value;
    }
    throw new Problem(
      "CONCURRENT_CHANGE",
      "The workspace changed concurrently. Reload and retry.",
      409,
    );
  }
  async snapshot(p: Principal) {
    requireScope(p, "workspace:read");
    const { state, revision } = await this.load(p.workspaceId);
    return { state, revision, verification: await verifyState(state) };
  }
  async tool(p: Principal, name: string, args: unknown): Promise<unknown> {
    if (name === "draft_followup") {
      // Hash outside the pure CAS callback; recompute when source version changes.
      const parsed = parse(draftSchema, args);
      return this.mutate(p, name, (s) => {
        requireScope(p, "tasks:draft");
        return {
          value: {
            payload: draftTask(s, parsed.orderId, parsed.priority),
            requiresApproval: true,
            authority: "proposal-only",
            trustBoundary:
              "Partner message text is untrusted data; template uses identifiers and error codes only.",
          },
          code: "DRAFT_RETURNED",
          details: { orderId: parsed.orderId },
        };
      });
    }
    if (name === "lookup_order" || name === "get_error_history") {
      const parsed = parse(
        z.object({ orderId: z.string().regex(/^ORD-\d{4}$/) }).strict(),
        args,
      );
      return this.mutate(p, name, (s) => {
        requireScope(
          p,
          name === "lookup_order" ? "orders:read" : "errors:read",
        );
        const order = assertOrder(s, parsed.orderId);
        return {
          value:
            name === "lookup_order"
              ? { order, synthetic: true, authority: "data-only" }
              : {
                  events: s.errors.filter((e) => e.orderId === order.id),
                  trust: "untrusted-external-data",
                  instructionAuthority: "none",
                },
          code: "READ_RETURNED",
          details: { orderId: order.id },
        };
      });
    }
    if (name === "create_followup") {
      const parsed = parse(executeSchema, args);
      return this.mutate(p, name, (s, now) => {
        requireScope(p, "tasks:create");
        const approval = s.approvals.find((a) => a.id === parsed.approvalId);
        if (!approval)
          throw new Problem(
            "APPROVAL_REQUIRED",
            "An approval from this workspace is required.",
            403,
          );
        if (
          approval.actor !== p.subject ||
          approval.resource !== p.audience ||
          approval.workspaceId !== p.workspaceId
        )
          throw new Problem(
            "APPROVAL_BINDING",
            "The approval is bound to a different actor or resource.",
            403,
          );
        if (approval.payloadHash !== parsed.payloadHash)
          throw new Problem(
            "PAYLOAD_CHANGED",
            "The submitted digest differs from the reviewed payload.",
            409,
          );
        const existing = s.tasks.find((t) => t.approvalId === approval.id);
        if (approval.status === "consumed" && existing)
          return {
            value: { task: existing, replayed: true },
            code: "IDEMPOTENT_REPLAY",
            details: { approvalId: approval.id, taskId: existing.id },
          };
        if (approval.status !== "approved")
          throw new Problem(
            approval.status === "rejected"
              ? "APPROVAL_REJECTED"
              : "APPROVAL_PENDING",
            "This proposal has not been approved.",
            403,
          );
        if (approval.expiresAt <= now)
          throw new Problem(
            "APPROVAL_EXPIRED",
            "The ten-minute approval has expired. Request a new review.",
            409,
          );
        const order = assertOrder(s, approval.payload.orderId);
        if (order.version !== approval.payload.orderVersion)
          throw new Problem(
            "STALE_ORDER",
            "The order version changed after drafting. Investigate and request a new approval.",
            409,
          );
        if (s.tasks.length >= limits.maxTasks)
          throw new Problem(
            "TASK_LIMIT",
            "The ten-task demo limit has been reached.",
            429,
          );
        const task = {
          id: crypto.randomUUID(),
          approvalId: approval.id,
          workspaceId: p.workspaceId,
          actor: p.subject,
          payloadHash: approval.payloadHash,
          payload: approval.payload,
          createdAt: now,
        };
        s.tasks.push(task);
        approval.status = "consumed";
        approval.taskId = task.id;
        order.version++;
        order.updatedAt = now;
        return {
          value: { task, replayed: false },
          code: "TASK_CREATED",
          details: { approvalId: approval.id, taskId: task.id, task },
        };
      });
    }
    throw new Problem("UNKNOWN_TOOL", "This tool is not registered.", 404);
  }
  async requestApproval(p: Principal, value: unknown, resource: string) {
    const body = parse(
      z
        .object({
          payload: taskSchema,
          payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
      value,
    );
    const hash = await payloadHash(body.payload);
    return this.mutate(p, "approval.request", (s, now) => {
      requireScope(p, "approval:request");
      if (hash !== body.payloadHash)
        throw new Problem(
          "PAYLOAD_CHANGED",
          "The proposal digest does not match its payload.",
          409,
        );
      const expected = draftTask(
        s,
        body.payload.orderId,
        body.payload.priority,
      );
      if (canonical(body.payload) !== canonical(expected))
        throw new Problem(
          "INVALID_PROPOSAL",
          "Only the bounded deterministic task template can be approved.",
          409,
        );
      if (s.approvals.length >= limits.maxApprovals)
        throw new Problem(
          "APPROVAL_LIMIT",
          "The twenty-proposal demo limit has been reached.",
          429,
        );
      const approval: Approval = {
        id: crypto.randomUUID(),
        workspaceId: p.workspaceId,
        actor: "demo-agent",
        resource,
        payload: body.payload,
        payloadHash: hash,
        createdAt: now,
        expiresAt: new Date(
          Date.parse(now) + limits.approvalMinutes * 60_000,
        ).toISOString(),
        status: "pending",
      };
      s.approvals.push(approval);
      return {
        value: approval,
        code: "APPROVAL_REQUESTED",
        details: {
          approvalId: approval.id,
          payloadHash: hash,
          payload: body.payload,
          actor: approval.actor,
          resource,
          expiresAt: approval.expiresAt,
        },
      };
    });
  }
  async decide(p: Principal, id: string, value: unknown) {
    const body = parse(
      z
        .object({
          decision: z.enum(["approved", "rejected"]),
          reason: z.string().trim().min(5).max(300),
        })
        .strict(),
      value,
    );
    return this.mutate(p, "approval.decide", (s, now) => {
      requireScope(p, "approval:decide");
      const approval = s.approvals.find((a) => a.id === id);
      if (!approval)
        throw new Problem(
          "APPROVAL_NOT_FOUND",
          "Approval was not found in this workspace.",
          404,
        );
      if (approval.status !== "pending")
        throw new Problem(
          "DECISION_FINAL",
          "This proposal already has a decision.",
          409,
        );
      if (approval.expiresAt <= now)
        throw new Problem(
          "APPROVAL_EXPIRED",
          "This proposal expired. Request a new review.",
          409,
        );
      if (
        assertOrder(s, approval.payload.orderId).version !==
        approval.payload.orderVersion
      )
        throw new Problem(
          "STALE_ORDER",
          "The source order changed. Request a new review.",
          409,
        );
      approval.status = body.decision;
      approval.decidedAt = now;
      approval.decidedBy = p.subject;
      approval.reason = body.reason;
      return {
        value: approval,
        code: "APPROVAL_DECIDED",
        details: {
          approvalId: id,
          decision: body.decision,
          reason: body.reason,
        },
      };
    });
  }
}
