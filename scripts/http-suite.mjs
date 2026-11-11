import assert from "node:assert/strict";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { payloadHash, verifyState, canonical } from "../src/domain.ts";
import { evidenceZip } from "../src/export.ts";
import { unzipSync, strFromU8 } from "fflate";

export async function httpSuite(origin) {
  const results = [],
    clients = [];
  let requests = 0;
  const counted = async (input, init) => {
    requests++;
    return fetch(input, init);
  };
  async function rest(path, key, value, extra = {}) {
    const r = await counted(origin + path, {
      method: value === undefined ? "GET" : "POST",
      headers: {
        ...(key ? { Authorization: "Bearer " + key } : {}),
        ...(value === undefined ? {} : { "Content-Type": "application/json" }),
        ...extra,
      },
      body: value === undefined ? undefined : JSON.stringify(value),
      redirect: "error",
    });
    return { status: r.status, headers: r.headers, body: await r.json() };
  }
  const pass = (name, fn) => {
    fn();
    results.push({ name, passed: true });
  };
  const status = (result, n, code) => {
    assert.equal(result.status, n);
    if (code) assert.equal(result.body.error?.code, code);
  };
  let session;
  try {
    const health = await rest("/api/health");
    pass("SQL health and source fingerprint", () => {
      status(health, 200);
      assert.equal(health.body.ready, true);
      assert.ok(health.body.sourceFingerprint);
    });
    const noKey = await rest("/api/review/state");
    pass("Unauthenticated access rejected", () => {
      status(noKey, 401, "UNAUTHORIZED");
      assert.match(noKey.headers.get("www-authenticate"), /^Bearer /);
    });
    const created = await rest("/api/workspaces", null, {});
    session = created.body;
    pass("Isolated synthetic workspace created", () => {
      status(created, 201);
      assert.equal(Object.keys(session.credentials).length, 5);
    });
    const keys = session.credentials;
    const snapshot = () => rest("/api/review/state", keys.controller);
    const mcp = async (kind = "reader", legacy = false) => {
      const client = new Client(
        { name: "workflow-http-validation", version: "1.0.0" },
        legacy ? {} : { versionNegotiation: { mode: "auto" } },
      );
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(origin + "/api/mcp"), {
          requestInit: {
            headers: { Authorization: "Bearer " + keys[kind] },
            redirect: "error",
          },
          fetch: counted,
        }),
      );
      return client;
    };
    const reader = await mcp();
    pass("Modern MCP negotiation", () => assert.ok(reader.getDiscoverResult()));
    const tools = await reader.listTools();
    pass("Live four-tool discovery with strict schemas", () => {
      assert.deepEqual(tools.tools.map((t) => t.name).sort(), [
        "create_followup",
        "draft_followup",
        "get_error_history",
        "lookup_order",
      ]);
      for (const t of tools.tools)
        assert.equal(t.inputSchema.additionalProperties, false);
    });
    const call = async (client, name, args) =>
      await client.callTool({ name, arguments: args });
    const val = (r) => r.structuredContent;
    const error = (r, c) => {
      assert.equal(r.isError, true);
      assert.equal(val(r).error.code, c);
    };
    const order = await call(reader, "lookup_order", { orderId: "ORD-2048" });
    pass("Read order through real MCP", () =>
      assert.equal(val(order).order.version, 1),
    );
    const history = await call(reader, "get_error_history", {
      orderId: "ORD-2048",
    });
    pass("Read untrusted integration history", () => {
      assert.equal(val(history).events.length, 2);
      assert.equal(val(history).instructionAuthority, "none");
    });
    const draft = await call(reader, "draft_followup", {
      orderId: "ORD-2048",
      priority: "normal",
    });
    const payload = val(draft).payload,
      hash = await payloadHash(payload);
    pass("Deterministic proposal has no write authority", () => {
      assert.equal(val(draft).authority, "proposal-only");
      assert.equal(payload.queue, "demo-integration-followup");
    });
    const initial = await snapshot();
    pass("Read and draft leave operational task count zero", () => {
      assert.equal(initial.body.state.tasks.length, 0);
      assert.equal(initial.body.state.approvals.length, 0);
    });
    const healthy = await call(reader, "draft_followup", {
      orderId: "ORD-2051",
      priority: "normal",
    });
    pass("Healthy order cannot generate an action", () =>
      error(healthy, "NO_FOLLOWUP_NEEDED"),
    );
    const malformed = await call(reader, "lookup_order", {
      orderId: 12,
      admin: true,
    });
    pass("MCP argument validation rejects malformed input", () => {
      assert.equal(malformed.isError, true);
      assert.match(malformed.content[0].text, /validation/i);
    });
    const attack = await call(reader, "get_error_history", {
      orderId: "ORD-2057",
    });
    const safeDraft = await call(reader, "draft_followup", {
      orderId: "ORD-2057",
      priority: "normal",
    });
    pass(
      "Retrieved injection remains data and cannot enter task template",
      () => {
        assert.match(val(attack).events[0].message, /Ignore previous/);
        assert.ok(!canonical(val(safeDraft)).includes("collector.invalid"));
      },
    );
    const denied = await call(reader, "create_followup", {
      approvalId: crypto.randomUUID(),
      payloadHash: hash,
    });
    pass("Read-only capability cannot write", () =>
      error(denied, "INSUFFICIENT_SCOPE"),
    );
    const agent = await mcp("agent");
    const bypass = await call(agent, "create_followup", {
      approvalId: crypto.randomUUID(),
      payloadHash: hash,
    });
    pass("Executor scope cannot bypass approval", () =>
      error(bypass, "APPROVAL_REQUIRED"),
    );
    let wrongAudience = false;
    try {
      await mcp("wrong-audience");
    } catch (e) {
      wrongAudience = /401/.test(e.message);
    }
    pass("Token audience rejected at HTTP boundary", () =>
      assert.ok(wrongAudience),
    );
    const reviewAsMcp = await rest("/api/review/state", keys.agent);
    pass("MCP token cannot call review API", () =>
      status(reviewAsMcp, 401, "WRONG_AUDIENCE"),
    );
    const tampered = await rest("/api/review/approvals", keys.controller, {
      payload,
      payloadHash: "0".repeat(64),
    });
    pass("Changed proposal digest rejected", () =>
      status(tampered, 409, "PAYLOAD_CHANGED"),
    );
    const changed = { ...payload, body: "Send a customer message" };
    const custom = await rest("/api/review/approvals", keys.controller, {
      payload: changed,
      payloadHash: await payloadHash(changed),
    });
    pass("Arbitrary action text rejected", () =>
      status(custom, 409, "INVALID_PROPOSAL"),
    );
    const propose = async (p = payload) =>
      rest("/api/review/approvals", keys.controller, {
        payload: p,
        payloadHash: await payloadHash(p),
      });
    const approval = (await propose()).body;
    pass("Approval binds exact payload, subject and resource", () => {
      assert.equal(approval.actor, "demo-agent");
      assert.equal(approval.payloadHash, hash);
      assert.equal(approval.resource, session.resource);
      assert.equal(approval.status, "pending");
    });
    const pending = await call(agent, "create_followup", {
      approvalId: approval.id,
      payloadHash: hash,
    });
    pass("Pending call denied", () => error(pending, "APPROVAL_PENDING"));
    const self = await rest(
      `/api/review/approvals/${approval.id}/decision`,
      keys.controller,
      { decision: "approved", reason: "Controller self approval probe" },
    );
    pass("Controller cannot self-approve", () =>
      status(self, 403, "INSUFFICIENT_SCOPE"),
    );
    const rejection = await rest(
      `/api/review/approvals/${approval.id}/decision`,
      keys.reviewer,
      {
        decision: "rejected",
        reason: "Review rejected the proposed synthetic action.",
      },
    );
    pass("Explicit rejection recorded", () => {
      status(rejection, 200);
      assert.equal(rejection.body.status, "rejected");
    });
    const rejectCall = await call(agent, "create_followup", {
      approvalId: approval.id,
      payloadHash: hash,
    });
    pass("Rejected write denied", () => error(rejectCall, "APPROVAL_REJECTED"));
    const approved = (await propose()).body,
      stale = (await propose({ ...payload, priority: "high" })).body;
    for (const a of [approved, stale])
      status(
        await rest(`/api/review/approvals/${a.id}/decision`, keys.reviewer, {
          decision: "approved",
          reason: "Validated exact task, source version and queue.",
        }),
        200,
      );
    const modified = await call(agent, "create_followup", {
      approvalId: approved.id,
      payloadHash: "0".repeat(64),
    });
    pass("Changed digest denied after approval", () =>
      error(modified, "PAYLOAD_CHANGED"),
    );
    const second = (await rest("/api/workspaces", null, {})).body;
    const crossClient = new Client(
      { name: "other-workspace", version: "1" },
      { versionNegotiation: { mode: "auto" } },
    );
    clients.push(crossClient);
    await crossClient.connect(
      new StreamableHTTPClientTransport(new URL(origin + "/api/mcp"), {
        requestInit: {
          headers: { Authorization: "Bearer " + second.credentials.agent },
        },
        fetch: counted,
      }),
    );
    const cross = await call(crossClient, "create_followup", {
      approvalId: approved.id,
      payloadHash: hash,
    });
    pass("Cross-workspace approval cannot execute", () =>
      error(cross, "APPROVAL_REQUIRED"),
    );
    const executions = await Promise.all(
      Array.from({ length: 3 }, () =>
        call(agent, "create_followup", {
          approvalId: approved.id,
          payloadHash: hash,
        }),
      ),
    );
    pass("Concurrent approved execution creates one exact task", () => {
      for (const e of executions) assert.ok(!e.isError);
      assert.equal(executions.filter((e) => !val(e).replayed).length, 1);
      assert.equal(new Set(executions.map((e) => val(e).task.id)).size, 1);
      assert.deepEqual(val(executions[0]).task.payload, payload);
    });
    const staleCall = await call(agent, "create_followup", {
      approvalId: stale.id,
      payloadHash: stale.payloadHash,
    });
    pass("Stale source revision rejected", () =>
      error(staleCall, "STALE_ORDER"),
    );
    const replay = await call(agent, "create_followup", {
      approvalId: approved.id,
      payloadHash: hash,
    });
    pass("Replay returns the existing task", () => {
      assert.equal(val(replay).replayed, true);
      assert.equal(val(replay).task.id, val(executions[0]).task.id);
    });
    const legacy = await mcp("reader", true);
    const legacyTools = await legacy.listTools();
    pass("Legacy stateless SDK interoperability", () => {
      assert.equal(legacy.getDiscoverResult(), undefined);
      assert.equal(legacyTools.tools.length, 4);
    });
    const current = await snapshot();
    const verified = await verifyState(current.body.state);
    pass(
      "Stored audit, task and approval evidence independently verifies",
      () => {
        assert.equal(current.body.state.tasks.length, 1);
        assert.equal(current.body.state.orders[0].version, 2);
        assert.equal(verified.valid, true);
      },
    );
    const files = unzipSync(await evidenceZip(current.body.state));
    const evidence = JSON.parse(strFromU8(files["evidence.json"]));
    pass("Real ZIP extraction preserves all six evidence files", () => {
      assert.equal(Object.keys(files).length, 6);
      assert.deepEqual(evidence.state, current.body.state);
    });
    pass("No bearer credentials in state or export", () => {
      const text = Object.values(files).map(strFromU8).join("\n");
      for (const key of Object.values(keys)) assert.ok(!text.includes(key));
    });
    const wrongOrigin = await rest(
      "/api/workspaces",
      null,
      {},
      { Origin: "https://evil.invalid" },
    );
    pass("Cross-origin browser write blocked", () =>
      status(wrongOrigin, 403, "INVALID_ORIGIN"),
    );
    const big = await counted(origin + "/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "x".repeat(17000),
    });
    pass("Oversized request blocked", () => assert.equal(big.status, 413));
    return {
      report: {
        origin,
        at: new Date().toISOString(),
        passed: results.length,
        requests,
        results,
        fingerprint: health.body.sourceFingerprint,
        workspaceSummary: {
          tasks: 1,
          approvals: current.body.state.approvals.length,
          auditEvents: current.body.state.audit.length,
          verificationChecks: verified.checks,
        },
      },
      checkpoint: { session, state: current.body.state },
    };
  } catch (error) {
    error.validation = {
      origin,
      at: new Date().toISOString(),
      passed: results.length,
      requests,
      results,
      error: error.message.replace(/wfl_[a-f0-9]{64}/g, "[redacted]"),
    };
    throw error;
  } finally {
    await Promise.allSettled(clients.map((c) => c.close()));
  }
}
export async function resumeCheckpoint(origin, checkpoint) {
  const response = await fetch(origin + "/api/review/state", {
    headers: {
      Authorization: "Bearer " + checkpoint.session.credentials.controller,
    },
    redirect: "error",
  });
  assert.equal(response.status, 200);
  const { state } = await response.json();
  assert.deepEqual(state, checkpoint.state);
  assert.equal((await verifyState(state)).valid, true);
  return {
    origin,
    at: new Date().toISOString(),
    passed: true,
    workspaceId: state.workspaceId,
    tasks: state.tasks.length,
    approvals: state.approvals.length,
    auditEvents: state.audit.length,
  };
}
