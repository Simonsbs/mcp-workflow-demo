import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Code2,
  FileCheck2,
  GitBranch,
  Layers3,
  LockKeyhole,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Terminal,
  TriangleAlert,
  X,
} from "lucide-react";
import type {
  Approval,
  ErrorEvent,
  Order,
  Session,
  Task,
  TaskPayload,
} from "./domain.ts";
import { payloadHash, Problem, verifyState } from "./domain.ts";
import {
  createSession,
  decideApproval,
  getSnapshot,
  mcpSession,
  requestApproval,
  toolValue,
} from "./client.ts";
import type { Snapshot, Wire } from "./client.ts";
import { evidenceZip } from "./export.ts";

type Tab =
  | "Investigation"
  | "Approvals"
  | "Tool catalog"
  | "Security checks"
  | "Audit & evidence";
type Investigation = {
  order: Order;
  events: ErrorEvent[];
  payload: TaskPayload;
  hash: string;
  protocol: string;
};
type Probe = { title: string; result: "pass" | "fail"; detail: string };
const tabs: Tab[] = [
  "Investigation",
  "Approvals",
  "Tool catalog",
  "Security checks",
  "Audit & evidence",
];
const storageKey = "workflow-lab-session-v1";
const short = (id: string) => id.slice(0, 8);
const when = (at: string) =>
  new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
function savedSession(): Session | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return value?.credentials?.controller &&
      value.expiresAt > new Date().toISOString()
      ? value
      : null;
  } catch {
    return null;
  }
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(savedSession);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<Tab>("Investigation");
  const [orderId, setOrderId] = useState("ORD-2048");
  const [priority, setPriority] = useState<"normal" | "high">("normal");
  const [investigation, setInvestigation] = useState<Investigation | null>(
    null,
  );
  const [wires, setWires] = useState<Wire[]>([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ kind: string; text: string } | null>(
    null,
  );
  const [role, setRole] = useState<"controller" | "reviewer">("controller");
  const [reason, setReason] = useState("");
  const [selectedApproval, setSelectedApproval] = useState("");
  const [probes, setProbes] = useState<Probe[]>([]);
  const [catalog, setCatalog] = useState<
    Array<{
      name: string;
      description?: string;
      inputSchema: unknown;
      annotations?: unknown;
    }>
  >([]);
  const [showWire, setShowWire] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [lastTask, setLastTask] = useState<Task | null>(null);
  const started = useRef(false);
  function wire(w: Wire) {
    setWires((old) => [w, ...old].slice(0, 60));
  }
  async function refresh(s = session) {
    if (s) setSnapshot(await getSnapshot(s));
  }
  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice({
        kind: "error",
        text:
          e instanceof Error
            ? `${e instanceof Problem ? e.code + ": " : ""}${e.message}`
            : "Request failed.",
      });
      if (session) await refresh(session).catch(() => {});
    } finally {
      setBusy("");
    }
  }
  async function newWorkspace() {
    const s = await createSession();
    localStorage.setItem(storageKey, JSON.stringify(s));
    setSession(s);
    setInvestigation(null);
    setWires([]);
    setProbes([]);
    setCatalog([]);
    setSelectedApproval("");
    setLastTask(null);
    setRole("controller");
    setConfirmNew(false);
    setReason("");
    await refresh(s);
    setNotice({
      kind: "success",
      text: "A private, synthetic workspace is ready. Access expires after 24 hours.",
    });
  }
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run("Opening workspace", async () => {
      if (session) await refresh(session);
      else await newWorkspace();
    });
  }, []);
  const approvals = snapshot?.state.approvals ?? [];
  const active =
    approvals.find((a) => a.id === selectedApproval) ?? approvals.at(-1);
  async function investigate() {
    if (!session) return;
    setInvestigation(null);
    setLastTask(null);
    await mcpSession(
      session,
      "reader",
      async (client) => {
        const listed = await client.listTools();
        setCatalog(listed.tools);
        const { order } = toolValue<{ order: Order }>(
          await client.callTool({
            name: "lookup_order",
            arguments: { orderId },
          }),
        );
        const { events } = toolValue<{ events: ErrorEvent[] }>(
          await client.callTool({
            name: "get_error_history",
            arguments: { orderId },
          }),
        );
        const { payload } = toolValue<{ payload: TaskPayload }>(
          await client.callTool({
            name: "draft_followup",
            arguments: { orderId, priority },
          }),
        );
        setInvestigation({
          order,
          events,
          payload,
          hash: await payloadHash(payload),
          protocol: client.getDiscoverResult()
            ? "2026-07-28"
            : "legacy stateless",
        });
      },
      wire,
    );
    await refresh();
  }
  async function propose() {
    if (!session || !investigation) return;
    const approval = await requestApproval(session, investigation.payload);
    setSelectedApproval(approval.id);
    setTab("Approvals");
    await refresh();
    setNotice({
      kind: "success",
      text: "Proposal recorded. It has no write authority until an explicit reviewer decision.",
    });
  }
  async function decide(decision: "approved" | "rejected") {
    if (!session || !active) return;
    await decideApproval(session, active.id, decision, reason, role);
    await refresh();
    setReason("");
    setNotice({
      kind: "success",
      text:
        decision === "approved"
          ? "Exact proposal approved for demo-agent. Execution remains a separate action."
          : "Proposal rejected. No task was created.",
    });
  }
  async function execute(approval: Approval) {
    if (!session) return;
    await mcpSession(
      session,
      "agent",
      async (client) => {
        const { task, replayed } = toolValue<{ task: Task; replayed: boolean }>(
          await client.callTool({
            name: "create_followup",
            arguments: {
              approvalId: approval.id,
              payloadHash: approval.payloadHash,
            },
          }),
        );
        setLastTask(task);
        setNotice({
          kind: "success",
          text: replayed
            ? `Replay returned the existing task ${short(task.id)}. No duplicate was created.`
            : `Synthetic task ${short(task.id)} created in the internal demo queue.`,
        });
      },
      wire,
    );
    await refresh();
  }
  async function securityChecks() {
    if (!session) return;
    setProbes([]);
    const results: Probe[] = [];
    async function check(
      title: string,
      expected: string,
      fn: () => Promise<void>,
    ) {
      try {
        await fn();
        results.push({
          title,
          result: "fail",
          detail: "Unexpectedly allowed. Inspect the wire evidence.",
        });
      } catch (e) {
        const message =
          e instanceof Problem
            ? `${e.code}: ${e.message}`
            : e instanceof Error
              ? e.message
              : String(e);
        results.push({
          title,
          result: message.includes(expected) ? "pass" : "fail",
          detail: message
            .replace(/wfl_[a-f0-9]{64}/g, "[redacted]")
            .slice(0, 450),
        });
      }
      setProbes([...results]);
    }
    const args = {
      approvalId: crypto.randomUUID(),
      payloadHash: "0".repeat(64),
    };
    await check("Wrong token audience", "401", async () => {
      await mcpSession(session, "wrong-audience", async () => {}, wire);
    });
    await check(
      "Read capability cannot write",
      "INSUFFICIENT_SCOPE",
      async () => {
        await mcpSession(
          session,
          "reader",
          async (c) => {
            toolValue(
              await c.callTool({ name: "create_followup", arguments: args }),
            );
          },
          wire,
        );
      },
    );
    await check(
      "Agent cannot bypass approval",
      "APPROVAL_REQUIRED",
      async () => {
        await mcpSession(
          session,
          "agent",
          async (c) => {
            toolValue(
              await c.callTool({ name: "create_followup", arguments: args }),
            );
          },
          wire,
        );
      },
    );
    await check("Controller cannot approve", "INSUFFICIENT_SCOPE", async () => {
      await decideApproval(
        session,
        crypto.randomUUID(),
        "approved",
        "Scope boundary probe",
        "controller",
      );
    });
    await check("Malformed arguments rejected", "validation", async () => {
      await mcpSession(
        session,
        "reader",
        async (c) => {
          toolValue(
            await c.callTool({
              name: "lookup_order",
              arguments: { orderId: 12, grantAdmin: true },
            }),
          );
        },
        wire,
      );
    });
    await refresh();
  }
  async function download() {
    if (!session) return;
    const current = await getSnapshot(session);
    setSnapshot(current);
    const bytes = await evidenceZip(current.state),
      blob = new Blob([bytes as BlobPart], { type: "application/zip" }),
      url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflow-evidence-${short(session.workspaceId)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice({
      kind: "success",
      text: "Six-file evidence ZIP generated after audit and task-binding verification.",
    });
  }
  return (
    <>
      <header className="topbar">
        <a href="/" className="brand" aria-label="Workflow Lab home">
          <span className="brand-icon">
            <GitBranch size={21} />
          </span>
          workflow<span className="brand-lab">lab</span>
        </a>
        <div className="top-links">
          <span className="synthetic-label">
            <span /> SYNTHETIC WORKSPACE
          </span>
          <a
            href="https://github.com/Simonsbs/mcp-workflow-demo"
            target="_blank"
            rel="noreferrer"
          >
            <Code2 size={16} />
            Source
            <ArrowUpRight size={13} />
          </a>
          <a href="https://bestdev.co.il" target="_blank" rel="noreferrer">
            Simon Stirling
            <ArrowUpRight size={13} />
          </a>
        </div>
      </header>
      <main className="shell">
        <div className="intro">
          <div>
            <div className="eyebrow">
              <span>05 / ENGINEERING DEMONSTRATOR</span>
              <span className="eyebrow-line" />
              MCP + CONTROLLED EXECUTION
            </div>
            <h1>
              Give tools access.
              <br />
              <span>Keep authority explicit.</span>
            </h1>
            <p className="lede">
              Investigate an integration issue through real MCP calls. Inspect
              the proposed action, review its permissions, then approve exactly
              one bounded write.
            </p>
          </div>
          <aside className="intro-note">
            <ShieldCheck size={25} />
            <strong>One task. One explicit decision.</strong>
            <p>Read first. Propose next. Write only after approval.</p>
            <div>
              <Badge tone="green">Real MCP transport</Badge>
              <Badge>Deterministic runner</Badge>
            </div>
          </aside>
        </div>
        <div className="flow" aria-label="Workflow boundaries">
          {[
            {
              n: "01",
              t: "Investigate",
              d: "Read-only MCP tools",
              icon: Search,
            },
            { n: "02", t: "Inspect", d: "Exact payload + digest", icon: Code2 },
            {
              n: "03",
              t: "Approve",
              d: "Separate review capability",
              icon: ShieldCheck,
            },
            {
              n: "04",
              t: "Execute",
              d: "One scoped synthetic task",
              icon: FileCheck2,
            },
          ].map((s, i) => (
            <div className="flow-step" key={s.n}>
              <span className="flow-number">{s.n}</span>
              <s.icon size={19} />
              <div>
                <strong>{s.t}</strong>
                <small>{s.d}</small>
              </div>
              {i < 3 && <ChevronRight className="flow-arrow" size={17} />}
            </div>
          ))}
        </div>
        <div className="workspace-head">
          <div>
            <span className="live-dot" />
            <strong>Investigation workspace</strong>
            <span className="workspace-id">
              {session ? short(session.workspaceId) : "Not connected"}
            </span>
          </div>
          <button
            className="text-button"
            disabled={!!busy}
            onClick={() => setConfirmNew(true)}
          >
            <RotateCcw size={14} />
            New workspace
          </button>
        </div>
        {confirmNew && (
          <div className="notice warning" role="alert">
            <span>
              The current workspace will remain until it expires, but this
              browser will switch to a new one. Download evidence first if
              needed.
            </span>
            <button
              onClick={() => void run("Creating workspace", newWorkspace)}
            >
              Create new workspace
            </button>
            <button
              className="text-button"
              onClick={() => setConfirmNew(false)}
            >
              Cancel
            </button>
          </div>
        )}
        {notice && (
          <div
            className={`notice ${notice.kind}`}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            {notice.kind === "error" ? (
              <TriangleAlert size={17} />
            ) : (
              <CheckCircle2 size={17} />
            )}
            <span>{notice.text}</span>
            <button
              className="icon-button"
              aria-label="Dismiss notice"
              onClick={() => setNotice(null)}
            >
              <X size={15} />
            </button>
          </div>
        )}
        <nav className="tabs" aria-label="Workspace sections">
          {tabs.map((t) => (
            <button
              key={t}
              aria-current={tab === t ? "page" : undefined}
              onClick={() => setTab(t)}
            >
              {t}
              {t === "Approvals" &&
                approvals.filter((a) => a.status === "pending").length > 0 && (
                  <span className="tab-count">
                    {approvals.filter((a) => a.status === "pending").length}
                  </span>
                )}
            </button>
          ))}
        </nav>
        <div className="busy-status" aria-live="polite">
          {busy && (
            <>
              <span className="spinner" />
              {busy}...
            </>
          )}
        </div>
        {tab === "Investigation" && (
          <div className="investigation-grid">
            <section className="panel investigate">
              <div className="panel-heading">
                <div>
                  <div className="kicker">READ SIDE</div>
                  <h2>Start with the evidence</h2>
                </div>
                <Badge tone="green">
                  <LockKeyhole size={12} />
                  Read-only
                </Badge>
              </div>
              <p className="muted">
                The investigator can look up orders, read errors and draft a
                task. It cannot approve its own proposal.
              </p>
              <div className="form-grid">
                <label>
                  Order
                  <select
                    value={orderId}
                    onChange={(e) => {
                      setOrderId(e.target.value);
                      setInvestigation(null);
                    }}
                  >
                    <option value="ORD-2048">
                      ORD-2048 · Delivery stalled
                    </option>
                    <option value="ORD-2057">
                      ORD-2057 · Injection fixture
                    </option>
                    <option value="ORD-2051">ORD-2051 · Healthy order</option>
                  </select>
                </label>
                <label>
                  Task priority
                  <select
                    value={priority}
                    onChange={(e) => {
                      setPriority(e.target.value as "normal" | "high");
                      setInvestigation(null);
                    }}
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </label>
              </div>
              <button
                className="primary"
                disabled={!!busy || !session}
                onClick={() =>
                  void run("Investigating through MCP", investigate)
                }
              >
                <Play size={15} />
                Investigate order
                <ArrowRight size={16} />
              </button>
              {investigation ? (
                <>
                  <div className="order-record">
                    <div>
                      <strong>{investigation.order.id}</strong>
                      <Badge tone="amber">Needs attention</Badge>
                    </div>
                    <h3>{investigation.order.customer}</h3>
                    <p>{investigation.order.item}</p>
                    <div className="record-meta">
                      <span>Version {investigation.order.version}</span>
                      <span>MCP {investigation.protocol}</span>
                      <span>{investigation.events.length} source events</span>
                    </div>
                  </div>
                  <div className="section-row">
                    <h3>Error history</h3>
                    <span className="data-label">UNTRUSTED DATA</span>
                  </div>
                  {investigation.events.map((e) => (
                    <article
                      className={`event ${e.injectionFixture ? "injection" : ""}`}
                      key={e.id}
                    >
                      <div>
                        <Badge tone={e.injectionFixture ? "amber" : "neutral"}>
                          {e.code}
                        </Badge>
                        <small>
                          {e.id} · {when(e.at)}
                        </small>
                      </div>
                      <p>{e.message}</p>
                      <small>{e.source}</small>
                      {e.injectionFixture && (
                        <div className="boundary">
                          <ShieldCheck size={15} />
                          Instruction authority: none. This text cannot approve
                          a task, issue a key or change the tool plan.
                        </div>
                      )}
                    </article>
                  ))}
                </>
              ) : (
                <div className="empty evidence-empty">
                  <div className="empty-symbol">
                    <Search size={25} />
                  </div>
                  <h3>Follow the issue to its source</h3>
                  <p>
                    Run the investigation to see the order, its error history
                    and the actual MCP exchange.
                  </p>
                  <div className="tool-sequence">
                    <code>lookup_order</code>
                    <ChevronDown size={12} />
                    <code>get_error_history</code>
                    <ChevronDown size={12} />
                    <code>draft_followup</code>
                  </div>
                </div>
              )}
            </section>
            <div className="right-stack">
              <section className="panel proposal">
                <div className="panel-heading">
                  <div>
                    <div className="kicker">WRITE BOUNDARY</div>
                    <h2>The proposed action</h2>
                  </div>
                  <span className="gate-icon">
                    <ShieldCheck size={21} />
                  </span>
                </div>
                {investigation ? (
                  <>
                    <div className="proposal-title">
                      <Badge tone="violet">Proposal only</Badge>
                      <h3>{investigation.payload.title}</h3>
                    </div>
                    <dl className="details">
                      <div>
                        <dt>Tool</dt>
                        <dd>
                          <code>create_followup</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Actor</dt>
                        <dd>demo-agent</dd>
                      </div>
                      <div>
                        <dt>Destination</dt>
                        <dd>Internal demo queue</dd>
                      </div>
                      <div>
                        <dt>Source binding</dt>
                        <dd>
                          {investigation.payload.orderId} / v
                          {investigation.payload.orderVersion}
                        </dd>
                      </div>
                      <div>
                        <dt>Approval window</dt>
                        <dd>10 minutes</dd>
                      </div>
                    </dl>
                    <details>
                      <summary>Inspect exact task payload</summary>
                      <Json value={investigation.payload} />
                    </details>
                    <label className="hash-label">
                      SHA-256 payload digest
                      <code className="hash">{investigation.hash}</code>
                    </label>
                    <div className="boundary">
                      <LockKeyhole size={15} />
                      No task exists yet. Approval binds to this exact payload
                      and source version.
                    </div>
                    <button
                      className="primary wide"
                      disabled={!!busy}
                      onClick={() => void run("Requesting review", propose)}
                    >
                      Send for approval
                      <ArrowRight size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="locked-state">
                      <LockKeyhole size={26} />
                      <strong>Waiting for a proposal</strong>
                      <p>
                        The write path stays closed until evidence has been
                        retrieved and a bounded action drafted.
                      </p>
                    </div>
                    <div className="check-list">
                      <p>
                        <Check size={14} />
                        Fixed internal queue
                      </p>
                      <p>
                        <Check size={14} />
                        Exact payload binding
                      </p>
                      <p>
                        <Check size={14} />
                        Explicit reviewer decision
                      </p>
                      <p>
                        <Check size={14} />
                        Atomic, replay-safe execution
                      </p>
                    </div>
                  </>
                )}
              </section>
              <div className="trust-note">
                <Layers3 size={20} />
                <div>
                  <strong>Data is not authority</strong>
                  <p>
                    Partner messages can explain a failure. They cannot grant
                    permissions or override the approval gate.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
        {tab === "Approvals" && (
          <div className="approval-grid">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <div className="kicker">CONTROL PLANE</div>
                  <h2>Review the exact action</h2>
                </div>
                <Badge tone="violet">Demo role switch</Badge>
              </div>
              <p className="muted">
                One visitor can switch roles. This demonstrates permission
                separation, not verified identity or two-person approval.
              </p>
              <label className="role-selector">
                Active review capability
                <select
                  value={role}
                  onChange={(e) =>
                    setRole(e.target.value as "controller" | "reviewer")
                  }
                >
                  <option value="controller">
                    Controller · can request, cannot approve
                  </option>
                  <option value="reviewer">
                    Reviewer · can approve or reject
                  </option>
                </select>
              </label>
              {approvals.length > 0 ? (
                <>
                  <label>
                    Proposal
                    <select
                      value={active?.id ?? ""}
                      onChange={(e) => {
                        setSelectedApproval(e.target.value);
                        setLastTask(null);
                      }}
                    >
                      {[...approvals].reverse().map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.payload.orderId} · {short(a.id)} · {a.status}
                        </option>
                      ))}
                    </select>
                  </label>
                  {active && (
                    <>
                      <div className="section-row">
                        <h3>{active.payload.title}</h3>
                        <Badge
                          tone={
                            active.status === "rejected"
                              ? "amber"
                              : active.status === "pending"
                                ? "violet"
                                : "green"
                          }
                        >
                          {active.status}
                        </Badge>
                      </div>
                      <Json value={active.payload} />
                      <dl className="details">
                        <div>
                          <dt>Bound actor</dt>
                          <dd>{active.actor}</dd>
                        </div>
                        <div>
                          <dt>Resource</dt>
                          <dd className="break">{active.resource}</dd>
                        </div>
                        <div>
                          <dt>Expires</dt>
                          <dd>{new Date(active.expiresAt).toLocaleString()}</dd>
                        </div>
                      </dl>
                      <code className="hash">{active.payloadHash}</code>
                      {active.status === "pending" ? (
                        <>
                          <label>
                            Decision reason
                            <textarea
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              maxLength={300}
                              placeholder="Explain why this bounded action is appropriate, or why it should be refused."
                            />
                          </label>
                          <small className="muted">
                            At least 5 characters. Your decision is retained in
                            the audit.
                          </small>
                          <div className="actions">
                            <button
                              className="secondary danger"
                              disabled={!!busy || reason.trim().length < 5}
                              onClick={() =>
                                void run("Recording rejection", () =>
                                  decide("rejected"),
                                )
                              }
                            >
                              <X size={15} />
                              Reject proposal
                            </button>
                            <button
                              className="primary"
                              disabled={!!busy || reason.trim().length < 5}
                              onClick={() =>
                                void run("Recording approval", () =>
                                  decide("approved"),
                                )
                              }
                            >
                              <Check size={15} />
                              Approve exact task
                            </button>
                          </div>
                          {role === "controller" && (
                            <p className="helper">
                              The current capability cannot decide. A decision
                              attempt will be rejected by the server.
                            </p>
                          )}
                        </>
                      ) : (
                        <div className="decision">
                          <strong>
                            {active.status === "rejected"
                              ? "Refused"
                              : "Approved"}{" "}
                            by {active.decidedBy}
                          </strong>
                          <p>{active.reason}</p>
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : (
                <div className="empty">
                  <FileCheck2 size={30} />
                  <h3>No proposals yet</h3>
                  <p>
                    Investigate an issue, inspect its payload and send it for
                    approval.
                  </p>
                  <button
                    className="secondary"
                    onClick={() => setTab("Investigation")}
                  >
                    Open investigation
                    <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </section>
            <div className="right-stack">
              <section className="panel">
                <div className="kicker">EXECUTION PLANE</div>
                <h2>Create the bounded task</h2>
                <p className="muted">
                  The executor has task scope, but scope alone is insufficient.
                  The server validates approval status, expiry, actor, audience,
                  digest and order version again.
                </p>
                <div className="tool-call">
                  <span>tools/call</span>
                  <code>create_followup</code>
                  <p>approvalId + payloadHash</p>
                </div>
                <button
                  className="primary wide"
                  disabled={!!busy || !active}
                  onClick={() =>
                    active &&
                    void run("Executing through MCP", () => execute(active))
                  }
                >
                  <Play size={15} />
                  {active?.status === "consumed"
                    ? "Replay same approved call"
                    : "Execute MCP call"}
                </button>
                <p className="helper">
                  You can attempt a pending or rejected call to observe the
                  server denial. A successful replay returns the existing task.
                </p>
                {lastTask && (
                  <div className="task-result">
                    <Badge tone="green">
                      <Check size={12} />
                      Task exists
                    </Badge>
                    <h3>{lastTask.payload.title}</h3>
                    <p>
                      Task {short(lastTask.id)} · {lastTask.payload.queue}
                    </p>
                    <details>
                      <summary>Inspect created task</summary>
                      <Json value={lastTask} />
                    </details>
                  </div>
                )}
              </section>
              <div className="trust-note">
                <Clock3 size={20} />
                <div>
                  <strong>Approval is bounded</strong>
                  <p>
                    A changed order needs a new proposal. A consumed approval
                    cannot create a second task.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
        {tab === "Tool catalog" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <div className="kicker">LIVE DISCOVERY</div>
                <h2>The server's tool contract</h2>
              </div>
              <button
                className="secondary"
                disabled={!!busy || !session}
                onClick={() =>
                  void run("Discovering MCP tools", async () => {
                    if (session)
                      await mcpSession(
                        session,
                        "reader",
                        async (c) => setCatalog((await c.listTools()).tools),
                        wire,
                      );
                  })
                }
              >
                <GitBranch size={15} />
                Discover tools
              </button>
            </div>
            <p className="muted">
              Schemas and annotations below come from the real MCP{" "}
              <code>tools/list</code> response. Hints describe behaviour; server
              capability and approval checks enforce it.
            </p>
            {catalog.length ? (
              <div className="catalog-grid">
                {catalog.map((t) => (
                  <article className="catalog-card" key={t.name}>
                    <Badge
                      tone={t.name === "create_followup" ? "amber" : "green"}
                    >
                      {t.name === "create_followup"
                        ? "Scoped write"
                        : "Read / propose"}
                    </Badge>
                    <h3>
                      <code>{t.name}</code>
                    </h3>
                    <p>{t.description}</p>
                    <details>
                      <summary>Input schema and annotations</summary>
                      <Json
                        value={{
                          inputSchema: t.inputSchema,
                          annotations: t.annotations,
                        }}
                      />
                    </details>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty">
                <Code2 size={28} />
                <h3>No cached tool list</h3>
                <p>Discover tools to inspect the current server contract.</p>
              </div>
            )}
            <div className="boundary">
              <Terminal size={17} />
              <div>
                <strong>External SDK clients</strong>
                <p>
                  Connect to <code>https://workflow.bestdev.co.il/api/mcp</code>{" "}
                  using the manual demo capability setup in the repository. This
                  demo does not implement OAuth or automatic ChatGPT plugin
                  installation.
                </p>
              </div>
            </div>
          </section>
        )}
        {tab === "Security checks" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <div className="kicker">ACTUAL DENIALS</div>
                <h2>Test the boundaries</h2>
              </div>
              <button
                className="primary"
                disabled={!!busy || !session}
                onClick={() =>
                  void run("Running live security probes", securityChecks)
                }
              >
                <ShieldCheck size={16} />
                Run security checks
              </button>
            </div>
            <p className="muted">
              These probes make actual requests against this workspace. They do
              not create operational tasks. A check passes only when the
              expected denial is observed.
            </p>
            {probes.length ? (
              <div className="probe-list">
                {probes.map((p) => (
                  <article key={p.title}>
                    <div>
                      {p.result === "pass" ? (
                        <CheckCircle2 size={20} />
                      ) : (
                        <TriangleAlert size={20} />
                      )}
                      <strong>{p.title}</strong>
                      <Badge tone={p.result === "pass" ? "green" : "amber"}>
                        {p.result}
                      </Badge>
                    </div>
                    <p>{p.detail}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty">
                <ShieldCheck size={30} />
                <h3>Observe enforcement, not a checklist</h3>
                <p>
                  Probe audience isolation, read-only scope, approval bypass,
                  review scope and malformed tool arguments.
                </p>
              </div>
            )}
            <div className="injection-tip">
              <TriangleAlert size={22} />
              <div>
                <h3>Try the retrieved-content attack</h3>
                <p>
                  Investigate ORD-2057. Its partner error asks for self-approval
                  and token exfiltration. The raw text remains visible as
                  untrusted evidence; the fixed runner and server permissions do
                  not change.
                </p>
                <button
                  className="text-button"
                  disabled={!!busy}
                  onClick={() => {
                    setOrderId("ORD-2057");
                    setInvestigation(null);
                    setTab("Investigation");
                  }}
                >
                  Open injection fixture
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>
          </section>
        )}
        {tab === "Audit & evidence" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <div className="kicker">INSPECTABLE OUTCOMES</div>
                <h2>A decision trail you can verify</h2>
              </div>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={!!busy || !session}
                  onClick={() => void run("Refreshing audit", () => refresh())}
                >
                  <RotateCcw size={15} />
                  Refresh
                </button>
                <button
                  className="primary"
                  disabled={!!busy || !session}
                  onClick={() => void run("Verifying and exporting", download)}
                >
                  <ArrowDownToLine size={15} />
                  Download evidence ZIP
                </button>
              </div>
            </div>
            <p className="muted">
              The audit retains domain reads, proposal decisions, write denials
              and task creation. Protocol validation errors remain visible in
              the wire inspector. Hash links detect partial tampering; they are
              not a digital signature.
            </p>
            <div className="stats">
              <div>
                <strong>{snapshot?.state.tasks.length ?? 0}</strong>
                <span>Synthetic tasks</span>
              </div>
              <div>
                <strong>{approvals.length}</strong>
                <span>Proposals</span>
              </div>
              <div>
                <strong>
                  {snapshot?.state.audit.filter((e) => e.outcome === "denied")
                    .length ?? 0}
                </strong>
                <span>Recorded denials</span>
              </div>
              <div>
                <strong
                  className={snapshot?.verification.valid ? "positive" : ""}
                >
                  {snapshot?.verification.valid ? "Verified" : "Unavailable"}
                </strong>
                <span>
                  {snapshot?.verification.checks ?? 0} evidence checks
                </span>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Sequence / time</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Result</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(snapshot?.state.audit ?? [])].reverse().map((e) => (
                    <tr key={e.id}>
                      <td>
                        <strong>#{e.sequence}</strong>
                        <small>{when(e.at)}</small>
                      </td>
                      <td>
                        <code>{e.actor}</code>
                      </td>
                      <td>
                        <code>{e.action}</code>
                      </td>
                      <td>
                        <Badge
                          tone={e.outcome === "denied" ? "amber" : "green"}
                        >
                          {e.code}
                        </Badge>
                      </td>
                      <td>
                        <details>
                          <summary>Details</summary>
                          <Json value={e} />
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="evidence-import">
              <summary>Verify an exported evidence.json</summary>
              <p className="muted">
                This runs locally in your browser. It does not import or
                overwrite the workspace.
              </p>
              <label className="file-label">
                Choose evidence.json
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      void run("Verifying imported evidence", async () => {
                        if (file.size > 1_000_000)
                          throw new Error("Evidence file exceeds 1 MB.");
                        const data = JSON.parse(await file.text());
                        const result = await verifyState(data.state);
                        setNotice({
                          kind: result.valid ? "success" : "error",
                          text: result.valid
                            ? `Imported evidence passed ${result.checks} checks.`
                            : `Evidence failed: ${result.errors.join("; ")}`,
                        });
                      });
                  }}
                />
              </label>
            </details>
          </section>
        )}
        <section className="wire-inspector">
          <button
            className="wire-toggle"
            aria-expanded={showWire}
            onClick={() => setShowWire(!showWire)}
          >
            <Terminal size={17} />
            <strong>MCP wire inspector</strong>
            <span>
              {wires.length} captured exchanges · no authorization headers
            </span>
            <ChevronDown size={17} />
          </button>
          {showWire && (
            <div className="wire-list">
              {wires.length ? (
                [...wires].map((w) => (
                  <details key={w.id}>
                    <summary>
                      <Badge tone={w.status >= 400 ? "amber" : "green"}>
                        HTTP {w.status}
                      </Badge>
                      <code>{w.method}</code>
                      <span>{w.durationMs} ms</span>
                    </summary>
                    <p className="muted">{w.transport}</p>
                    <div className="wire-pair">
                      <div>
                        <h4>Request body</h4>
                        <Json value={w.request} />
                      </div>
                      <div>
                        <h4>Response body</h4>
                        <Json value={w.response} />
                      </div>
                    </div>
                  </details>
                ))
              ) : (
                <p className="muted">
                  Run an investigation or discover the tools to capture the
                  actual exchange.
                </p>
              )}
            </div>
          )}
        </section>
        <div className="method">
          <div>
            <div className="kicker">WHAT THIS DEMONSTRATES</div>
            <h3>Useful tools, controlled authority.</h3>
            <p>
              Official MCP client and server SDKs, Streamable HTTP, audience and
              scope checks, immutable approval binding, atomic execution and
              inspectable evidence.
            </p>
          </div>
          <div>
            <div className="kicker">SCOPE & LIMITS</div>
            <p>
              All operational records are synthetic. The runner is
              deterministic, with no model inference. Demo roles share one
              visitor. Manual bearer capabilities are not a production OAuth
              service.
            </p>
            <a href="/docs/BUILD_NOTES.md" target="_blank" rel="noreferrer">
              Architecture & trade-offs
              <ArrowUpRight size={14} />
            </a>
            <a href="/docs/VALIDATION.md" target="_blank" rel="noreferrer">
              Validation evidence
              <ArrowUpRight size={14} />
            </a>
          </div>
        </div>
      </main>
      <footer className="footer">
        <span>
          WORKFLOW LAB <span className="footer-dot">/</span> Built by Simon
          Stirling
        </span>
        <span>Public demonstration · workspace expires in 24 hours</span>
        <a
          href="https://github.com/Simonsbs/mcp-workflow-demo"
          target="_blank"
          rel="noreferrer"
        >
          Inspect the source
          <ArrowUpRight size={13} />
        </a>
      </footer>
    </>
  );
}
