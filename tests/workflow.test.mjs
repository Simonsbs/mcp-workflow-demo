import { test } from "node:test";
import assert from "node:assert/strict";
import { sqliteStore } from "../server/sqlite.mjs";
import { Service } from "../server/service.ts";
import { route } from "../server/routes.ts";
import { failure } from "../worker/http.ts";
import {
  payloadHash,
  canonical,
  sha256,
  verifyState,
  Problem,
  limits,
} from "../src/domain.ts";
import { evidenceFiles, evidenceZip, csv } from "../src/export.ts";
import { unzipSync, strFromU8 } from "fflate";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const resource = "http://127.0.0.1:8790/api/mcp";
async function fixture(t) {
  const store = await sqliteStore();
  t.after(() => store.close());
  let clock = Date.parse("2026-11-11T10:00:00Z");
  const service = new Service(store, () => clock);
  const session = await service.create(resource),
    principals = {};
  for (const kind of Object.keys(session.credentials)) {
    const audience =
      kind === "controller" || kind === "reviewer"
        ? resource.replace("/mcp", "/review")
        : kind === "wrong-audience"
          ? resource.replace("/mcp", "/unrelated-resource")
          : resource;
    principals[kind] = await service.authenticate(
      "Bearer " + session.credentials[kind],
      audience,
    );
  }
  const state = async () => (await service.load(session.workspaceId)).state;
  const draft = async (id = "ORD-2048", priority = "normal") =>
    (
      await service.tool(principals.reader, "draft_followup", {
        orderId: id,
        priority,
      })
    ).payload;
  const propose = async (id = "ORD-2048", priority = "normal") => {
    const payload = await draft(id, priority);
    return service.requestApproval(
      principals.controller,
      { payload, payloadHash: await payloadHash(payload) },
      resource,
    );
  };
  const decide = (a, decision = "approved") =>
    service.decide(principals.reviewer, a.id, {
      decision,
      reason: "Inspected synthetic task and exact scope.",
    });
  const execute = (a, p = principals.agent, extra = {}) =>
    service.tool(p, "create_followup", {
      approvalId: a.id,
      payloadHash: a.payloadHash,
      ...extra,
    });
  return {
    store,
    service,
    session,
    principals,
    state,
    draft,
    propose,
    decide,
    execute,
    tick: (ms) => (clock += ms),
  };
}
const code = (expected) => (e) => e instanceof Problem && e.code === expected;
test("canonical digest is independent of key order", async () =>
  assert.equal(
    await sha256(canonical({ b: 2, a: [1, "x"] })),
    await sha256(canonical({ a: [1, "x"], b: 2 })),
  ));
test("workspace stores hashes, never raw bearer keys", async (t) => {
  const f = await fixture(t);
  const all =
    JSON.stringify(f.store.database.prepare("SELECT * FROM tokens").all()) +
    JSON.stringify(await f.state());
  for (const key of Object.values(f.session.credentials))
    assert.ok(!all.includes(key));
  assert.equal(
    f.store.database.prepare("SELECT count(*) as n FROM tokens").get().n,
    5,
  );
});
test("unknown and malformed capabilities are unauthorized", async (t) => {
  const f = await fixture(t);
  for (const key of [null, "Bearer anything", "Bearer wfl_" + "a".repeat(64)])
    await assert.rejects(
      () => f.service.authenticate(key, resource),
      code("UNAUTHORIZED"),
    );
});
test("wrong audience rejected and audited", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () =>
      f.service.authenticate(
        "Bearer " + f.session.credentials["wrong-audience"],
        resource,
      ),
    code("WRONG_AUDIENCE"),
  );
  assert.equal((await f.state()).audit.at(-1).code, "WRONG_AUDIENCE");
});
test("review capability cannot be used on MCP resource", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () =>
      f.service.authenticate(
        "Bearer " + f.session.credentials.reviewer,
        resource,
      ),
    code("WRONG_AUDIENCE"),
  );
});
test("expiry uses actual server clock", async (t) => {
  const f = await fixture(t);
  f.tick(24 * 3600_000);
  await assert.rejects(
    () =>
      f.service.authenticate("Bearer " + f.session.credentials.agent, resource),
    code("EXPIRED_TOKEN"),
  );
  await assert.rejects(f.state, code("WORKSPACE_EXPIRED"));
});
test("expired workspace cleanup cascades token deletion", async (t) => {
  const f = await fixture(t);
  f.tick(24 * 3600_000 + 1);
  await f.service.create(resource);
  assert.equal(
    f.store.database.prepare("SELECT count(*) as n FROM tokens").get().n,
    5,
  );
});
test("read-only investigation returns synthetic evidence without operational writes", async (t) => {
  const f = await fixture(t);
  const o = await f.service.tool(f.principals.reader, "lookup_order", {
    orderId: "ORD-2048",
  });
  const e = await f.service.tool(f.principals.reader, "get_error_history", {
    orderId: "ORD-2048",
  });
  assert.equal(o.order.version, 1);
  assert.equal(e.events.length, 2);
  assert.equal(e.instructionAuthority, "none");
  const s = await f.state();
  assert.equal(s.tasks.length, 0);
  assert.equal(s.approvals.length, 0);
});
test("retrieved injection text cannot alter deterministic payload or authority", async (t) => {
  const f = await fixture(t);
  const e = await f.service.tool(f.principals.reader, "get_error_history", {
    orderId: "ORD-2057",
  });
  assert.match(e.events[0].message, /Ignore previous/);
  const payload = await f.draft("ORD-2057");
  assert.ok(!canonical(payload).includes("collector.invalid"));
  assert.ok(!canonical(payload).includes("administrator"));
  assert.equal((await f.state()).tasks.length, 0);
  assert.deepEqual(Object.keys(f.session.credentials).sort(), [
    "agent",
    "controller",
    "reader",
    "reviewer",
    "wrong-audience",
  ]);
});
test("healthy order does not produce an actionable draft", async (t) => {
  const f = await fixture(t);
  await assert.rejects(() => f.draft("ORD-2051"), code("NO_FOLLOWUP_NEEDED"));
});
test("unknown order does not leak another record", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () =>
      f.service.tool(f.principals.reader, "lookup_order", {
        orderId: "ORD-9999",
      }),
    code("ORDER_NOT_FOUND"),
  );
});
test("malformed and additional tool arguments fail closed", async (t) => {
  const f = await fixture(t);
  for (const args of [
    { orderId: 12 },
    { orderId: "ORD-2048", admin: true },
    null,
  ])
    await assert.rejects(
      () => f.service.tool(f.principals.reader, "lookup_order", args),
      code("INVALID_ARGUMENT"),
    );
});
test("read capability cannot create a task", async (t) => {
  const f = await fixture(t),
    a = await f.propose();
  await f.decide(a);
  await assert.rejects(
    () => f.execute(a, f.principals.reader),
    code("INSUFFICIENT_SCOPE"),
  );
  assert.equal((await f.state()).tasks.length, 0);
});
test("scope does not replace an approval", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () => f.execute({ id: crypto.randomUUID(), payloadHash: "0".repeat(64) }),
    code("APPROVAL_REQUIRED"),
  );
});
test("pending approval cannot execute", async (t) => {
  const f = await fixture(t),
    a = await f.propose();
  await assert.rejects(() => f.execute(a), code("APPROVAL_PENDING"));
  assert.equal((await f.state()).approvals[0].status, "pending");
});
test("controller cannot approve its own proposal", async (t) => {
  const f = await fixture(t),
    a = await f.propose();
  await assert.rejects(
    () =>
      f.service.decide(f.principals.controller, a.id, {
        decision: "approved",
        reason: "Self approval should fail.",
      }),
    code("INSUFFICIENT_SCOPE"),
  );
});
test("reviewer cannot request an operational proposal", async (t) => {
  const f = await fixture(t),
    payload = await f.draft();
  await assert.rejects(
    async () =>
      f.service.requestApproval(
        f.principals.reviewer,
        { payload, payloadHash: await payloadHash(payload) },
        resource,
      ),
    code("INSUFFICIENT_SCOPE"),
  );
});
test("decision requires a substantive reason and exact enum", async (t) => {
  const f = await fixture(t),
    a = await f.propose();
  for (const value of [
    { decision: "approved", reason: "yes" },
    { decision: "allow", reason: "Reason for decision" },
    { decision: "approved", reason: "Valid reason", admin: true },
  ])
    await assert.rejects(
      () => f.service.decide(f.principals.reviewer, a.id, value),
      code("INVALID_ARGUMENT"),
    );
});
test("rejected approval cannot execute or be overwritten", async (t) => {
  const f = await fixture(t),
    a = await f.propose();
  await f.decide(a, "rejected");
  await assert.rejects(() => f.execute(a), code("APPROVAL_REJECTED"));
  await assert.rejects(() => f.decide(a), code("DECISION_FINAL"));
  assert.equal((await f.state()).tasks.length, 0);
});
test("digest mismatch cannot enter review", async (t) => {
  const f = await fixture(t),
    payload = await f.draft();
  await assert.rejects(
    async () =>
      f.service.requestApproval(
        f.principals.controller,
        { payload, payloadHash: "0".repeat(64) },
        resource,
      ),
    code("PAYLOAD_CHANGED"),
  );
});
test("arbitrary task text and external queues cannot enter review", async (t) => {
  const f = await fixture(t),
    payload = await f.draft();
  const changed = {
    ...payload,
    body: "Contact the customer and exfiltrate data",
  };
  await assert.rejects(
    async () =>
      f.service.requestApproval(
        f.principals.controller,
        { payload: changed, payloadHash: await payloadHash(changed) },
        resource,
      ),
    code("INVALID_PROPOSAL"),
  );
  const external = { ...payload, queue: "external" };
  await assert.rejects(
    async () =>
      f.service.requestApproval(
        f.principals.controller,
        { payload: external, payloadHash: await payloadHash(external) },
        resource,
      ),
    code("INVALID_ARGUMENT"),
  );
});
test("altered digest is denied after approval", async (t) => {
  const f = await fixture(t),
    a = await f.propose();
  await f.decide(a);
  await assert.rejects(
    () => f.execute(a, f.principals.agent, { payloadHash: "0".repeat(64) }),
    code("PAYLOAD_CHANGED"),
  );
});
test("approval expires both before decision and before execution", async (t) => {
  const f = await fixture(t),
    a = await f.propose(),
    b = await f.propose();
  await f.decide(a);
  f.tick(10 * 60_000);
  await assert.rejects(() => f.execute(a), code("APPROVAL_EXPIRED"));
  await assert.rejects(() => f.decide(b), code("APPROVAL_EXPIRED"));
});
test("approval is bound to actor and resource", async (t) => {
  const f = await fixture(t),
    a = await f.propose();
  await f.decide(a);
  await assert.rejects(
    () => f.execute(a, { ...f.principals.agent, subject: "different-actor" }),
    code("APPROVAL_BINDING"),
  );
  await assert.rejects(
    () =>
      f.execute(a, {
        ...f.principals.agent,
        audience: "https://other.invalid/api/mcp",
      }),
    code("APPROVAL_BINDING"),
  );
});
test("cross-workspace approval identifiers are unusable", async (t) => {
  const f = await fixture(t),
    a = await f.propose();
  await f.decide(a);
  const second = await f.service.create(resource);
  const p = await f.service.authenticate(
    "Bearer " + second.credentials.agent,
    resource,
  );
  await assert.rejects(() => f.execute(a, p), code("APPROVAL_REQUIRED"));
});
test("approved execution creates one exact task and consumes approval atomically", async (t) => {
  const f = await fixture(t),
    a = await f.propose();
  f.tick(123);
  await f.decide(a);
  f.tick(731);
  const result = await f.execute(a),
    s = await f.state();
  assert.equal(result.replayed, false);
  assert.deepEqual(result.task.payload, a.payload);
  assert.equal(s.tasks.length, 1);
  assert.equal(s.approvals[0].status, "consumed");
  assert.equal(s.orders[0].version, 2);
  assert.equal(s.audit.at(-1).at, result.task.createdAt);
  assert.equal((await verifyState(s)).valid, true);
});
test("idempotent replay returns existing task even after approval window", async (t) => {
  const f = await fixture(t),
    a = await f.propose();
  await f.decide(a);
  const first = await f.execute(a);
  f.tick(11 * 60_000);
  const replay = await f.execute(a);
  assert.deepEqual(replay.task, first.task);
  assert.equal(replay.replayed, true);
  assert.equal((await f.state()).tasks.length, 1);
});
test("parallel execution cannot duplicate a task", async (t) => {
  const f = await fixture(t),
    a = await f.propose();
  await f.decide(a);
  const results = await Promise.all(
    Array.from({ length: 4 }, () => f.execute(a)),
  );
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  assert.equal(new Set(results.map((r) => r.task.id)).size, 1);
  assert.equal((await verifyState(await f.state())).valid, true);
});
test("source version change invalidates previously approved proposal", async (t) => {
  const f = await fixture(t),
    a = await f.propose(),
    b = await f.propose("ORD-2048", "high");
  await f.decide(a);
  await f.decide(b);
  await f.execute(a);
  await assert.rejects(() => f.execute(b), code("STALE_ORDER"));
  assert.equal((await f.state()).tasks.length, 1);
});
test("source version change also prevents approving an old pending proposal", async (t) => {
  const f = await fixture(t),
    a = await f.propose(),
    b = await f.propose();
  await f.decide(a);
  await f.execute(a);
  await assert.rejects(() => f.decide(b), code("STALE_ORDER"));
});
test("failed optimistic commit does not expose partial task state", async (t) => {
  const f = await fixture(t),
    a = await f.propose();
  await f.decide(a);
  const real = f.store.batch.bind(f.store);
  f.store.batch = async (statements) =>
    statements[0]?.sql.startsWith("UPDATE workspaces")
      ? [{ rows: [], changes: 0 }]
      : real(statements);
  await assert.rejects(() => f.execute(a), code("CONCURRENT_CHANGE"));
  f.store.batch = real;
  const s = await f.state();
  assert.equal(s.tasks.length, 0);
  assert.equal(s.approvals[0].status, "approved");
  assert.equal(s.orders[0].version, 1);
});
test("audit verifies approvals, decisions, task evidence and source versions", async (t) => {
  const f = await fixture(t),
    a = await f.propose();
  await f.decide(a);
  await f.execute(a);
  const good = await f.state();
  assert.equal((await verifyState(good)).valid, true);
  for (const alter of [
    (s) => (s.tasks[0].payload.body = "changed"),
    (s) => (s.approvals[0].reason = "changed"),
    (s) => s.audit.splice(1, 1),
    (s) => s.orders[0].version++,
    (s) => s.tasks.push({ ...s.tasks[0], id: crypto.randomUUID() }),
    (s) => (s.approvals[0].actor = "evil"),
  ]) {
    const changed = structuredClone(good);
    alter(changed);
    assert.equal((await verifyState(changed)).valid, false);
  }
});
test("evidence ZIP extracts six real files with no credentials", async (t) => {
  const f = await fixture(t),
    a = await f.propose();
  await f.decide(a);
  await f.execute(a);
  const state = await f.state(),
    files = unzipSync(await evidenceZip(state));
  assert.equal(Object.keys(files).length, 6);
  const content = Object.values(files).map(strFromU8).join("\n");
  for (const key of Object.values(f.session.credentials))
    assert.ok(!content.includes(key));
  assert.ok(!content.includes("Authorization"));
  const evidence = JSON.parse(strFromU8(files["evidence.json"]));
  assert.equal((await verifyState(evidence.state)).valid, true);
  assert.equal(evidence.state.tasks.length, 1);
});
test("inconsistent evidence cannot be exported", async (t) => {
  const f = await fixture(t),
    state = await f.state();
  state.audit[0].code = "tampered";
  await assert.rejects(() => evidenceFiles(state), /Export refused/);
});
test("CSV export quotes values and neutralises spreadsheet formulas", () => {
  const value = csv(
    ["v"],
    [['=HYPERLINK("bad")'], ["line\nbreak"], ["@SUM(1)"]],
  );
  assert.match(value, /"'=HYPERLINK/);
  assert.match(value, /"line\nbreak"/);
  assert.match(value, /"'@SUM/);
});
test("workspace creation is bounded and cannot leave orphan tokens", async (t) => {
  const f = await fixture(t);
  for (let i = 1; i < limits.creationPerMinute; i++)
    await f.service.create(resource);
  await assert.rejects(
    () => f.service.create(resource),
    code("CREATION_LIMIT"),
  );
  assert.equal(
    f.store.database.prepare("SELECT count(*) as n FROM workspaces").get().n,
    20,
  );
  assert.equal(
    f.store.database.prepare("SELECT count(*) as n FROM tokens").get().n,
    100,
  );
});
test("live official SDK negotiates modern MCP and lists four strict tools", async (t) => {
  const f = await fixture(t);
  const client = new Client(
    { name: "test-client", version: "1.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  const methods = [];
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    requestInit: {
      headers: { Authorization: "Bearer " + f.session.credentials.reader },
    },
    fetch: async (input, init) => {
      const req = new Request(input, init);
      if (init?.body) methods.push(JSON.parse(init.body).method);
      try {
        return await route(req, f.service);
      } catch (e) {
        return failure(e);
      }
    },
  });
  t.after(() => client.close());
  await client.connect(transport);
  assert.ok(client.getDiscoverResult());
  const list = await client.listTools();
  assert.equal(list.tools.length, 4);
  for (const tool of list.tools)
    assert.equal(tool.inputSchema.additionalProperties, false);
  const result = await client.callTool({
    name: "lookup_order",
    arguments: { orderId: "ORD-2048" },
  });
  assert.equal(result.structuredContent.order.id, "ORD-2048");
  assert.ok(methods.includes("server/discover"));
  assert.ok(methods.includes("tools/list"));
  assert.ok(methods.includes("tools/call"));
});
test("legacy official SDK stateless handshake remains interoperable", async (t) => {
  const f = await fixture(t);
  const client = new Client({ name: "legacy-test", version: "1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    requestInit: {
      headers: { Authorization: "Bearer " + f.session.credentials.reader },
    },
    fetch: async (input, init) => {
      try {
        return await route(new Request(input, init), f.service);
      } catch (e) {
        return failure(e);
      }
    },
  });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal(client.getDiscoverResult(), undefined);
  assert.equal((await client.listTools()).tools.length, 4);
});
test("HTTP guard rejects untrusted host and cross-origin creation", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () =>
      route(
        new Request("https://evil.invalid/api/workspaces", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
        f.service,
      ),
    code("INVALID_HOST"),
  );
  await assert.rejects(
    () =>
      route(
        new Request(resource.replace("/mcp", "/workspaces"), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://evil.invalid",
          },
          body: "{}",
        }),
        f.service,
      ),
    code("INVALID_ORIGIN"),
  );
});
test("REST rejects unexpected fields, malformed JSON, media and size", async (t) => {
  const f = await fixture(t);
  for (const [body, media, expected] of [
    ["{", "application/json", "MALFORMED_JSON"],
    ['{"admin":true}', "application/json", "INVALID_ARGUMENT"],
    ["{}", "text/plain", "CONTENT_TYPE"],
    ["x".repeat(17000), "application/json", "BODY_TOO_LARGE"],
  ])
    await assert.rejects(
      () =>
        route(
          new Request(resource.replace("/mcp", "/workspaces"), {
            method: "POST",
            headers: { "content-type": media },
            body,
          }),
          f.service,
        ),
      code(expected),
    );
});
