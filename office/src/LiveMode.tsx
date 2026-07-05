import React, { useState, useEffect, useCallback, useRef } from "react";

// =====================================================
// ClearBorder Live Mode — Product Website
// =====================================================
// Reuses Scene 4's three agents + confirm gate.
// No scripted beats — agents animate from real WS events only.
// Entry: ?mode=live or /live

const WS_URL = "ws://localhost:3001/ws";
const API = "http://localhost:3001";

type AgentState = "idle" | "walking" | "typing" | "reading" | "waiting" | "sleeping";

interface Agent {
  id: string; name: string; role: string; state: AgentState;
  message?: string; skinColor: string; shirtColor: string;
  deskX: number; deskY: number;
}

const INITIAL_AGENTS: Agent[] = [
  { id: "translator", name: "Translator", role: "Live Translate", state: "idle", skinColor: "#ffd5a5", shirtColor: "#f59e0b", deskX: 18, deskY: 55 },
  { id: "casefile", name: "Case-file", role: "Persistence", state: "idle", skinColor: "#e8c9a0", shirtColor: "#3b82f6", deskX: 50, deskY: 55 },
  { id: "portal", name: "Portal", role: "Computer Use", state: "idle", skinColor: "#d4a574", shirtColor: "#10b981", deskX: 82, deskY: 55 },
];

// ── Pixel Character ──
function PixelChar({ skin, shirt, sleeping = false }: { skin: string; shirt: string; sleeping?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ width: 18, height: 18, background: skin, borderRadius: "4px 4px 2px 2px", position: "relative" }}>
        <div style={{ position: "absolute", top: -2, left: -1, right: -1, height: 8, background: shirt, borderRadius: "4px 4px 0 0" }} />
        <div style={{ position: "absolute", bottom: 5, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 5 }}>
          <div style={{ width: 3, height: sleeping ? 1 : 3, background: "#1a1a2e", borderRadius: 1 }} />
          <div style={{ width: 3, height: sleeping ? 1 : 3, background: "#1a1a2e", borderRadius: 1 }} />
        </div>
      </div>
      <div style={{ width: 16, height: 12, background: shirt, borderRadius: "0 0 2px 2px", marginTop: -1 }} />
      <div style={{ display: "flex", gap: 2, marginTop: -1 }}>
        <div style={{ width: 6, height: 8, background: "#2a2a44", borderRadius: "0 0 2px 2px" }} />
        <div style={{ width: 6, height: 8, background: "#2a2a44", borderRadius: "0 0 2px 2px" }} />
      </div>
    </div>
  );
}

// ── Agent Workstation ──
function AgentWorkstation({ agent }: { agent: Agent }) {
  const isActive = agent.state !== "idle" && agent.state !== "sleeping";
  const isSleeping = agent.state === "sleeping";
  const isWaiting = agent.state === "waiting";

  return (
    <div className={`pixel-workstation ${agent.state}`} style={{ left: `${agent.deskX}%`, top: `${agent.deskY}%` }}>
      <div className="agent-glow" style={{ background: agent.shirtColor }} />
      <div className="pixel-desk">
        <div className="desk-top" />
        <div className="desk-legs" />
      </div>
      <div className="pixel-character-station">
        <div className={`pixel-monitor ${isActive ? "on" : ""}`}>
          <div className="monitor-screen">{isActive && <div className="screen-lines" />}</div>
          <div className="monitor-stand" />
        </div>
      </div>
      <div className={`pixel-character ${agent.state}`}>
        <div className="char-shadow" />
        <PixelChar skin={agent.skinColor} shirt={agent.shirtColor} sleeping={isSleeping} />
        {isSleeping && (
          <div className="zzz-container">
            <span className="zzz z1">z</span><span className="zzz z2">z</span><span className="zzz z3">Z</span>
          </div>
        )}
        {isWaiting && <div className="wait-bubble"><span>?</span></div>}
      </div>
      <div className="agent-nametag">
        <span className="nametag-name">{agent.name}</span>
        <span className={`nametag-status ${agent.state}`}>
          {agent.state === "typing" ? "Working" : agent.state === "reading" ? "Analyzing" : agent.state === "waiting" ? "Awaiting" : agent.state === "sleeping" ? "Sleeping" : "Idle"}
        </span>
      </div>
      {agent.message && <div className="pixel-speech">{agent.message}</div>}
    </div>
  );
}

// ── Main LiveMode Component ──
export default function LiveMode() {
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [wsConnected, setWsConnected] = useState(false);
  const [caseFacts, setCaseFacts] = useState<string[]>([]);
  const [approvalPending, setApprovalPending] = useState(false);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [changeFeed, setChangeFeed] = useState<string[]>([]);
  const [sessionStatus, setSessionStatus] = useState<string>("idle");
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [nextCheck, setNextCheck] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [sessionRegistered, setSessionRegistered] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // ── Agent helpers ──
  const updateAgent = useCallback((id: string, patch: Partial<Agent>) => {
    setAgents(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));
  }, []);

  const setAgentTemp = useCallback((id: string, state: AgentState, msg: string, durationMs: number) => {
    updateAgent(id, { state, message: msg });
    setTimeout(() => updateAgent(id, { state: "idle", message: undefined }), durationMs);
  }, [updateAgent]);

  // ── WebSocket ──
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => {
        setWsConnected(false);
        setTimeout(connect, 2000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const { event, data } = msg;
          const ts = new Date().toLocaleTimeString();

          switch (event) {
            case "fact_captured":
              setAgentTemp("translator", "typing", `Captured: ${data.docKind}`, 3000);
              setAgentTemp("casefile", "reading", `Stored: ${data.docKind}`, 3000);
              setCaseFacts(prev => {
                const entry = `${data.docKind}: ${data.value}`;
                if (prev.includes(entry)) return prev;
                return [...prev, entry];
              });
              setChangeFeed(prev => [`${ts} — Fact captured: ${data.docKind}`, ...prev].slice(0, 20));
              break;

            case "case_created":
              setAgentTemp("casefile", "typing", "New case created", 2000);
              setCaseId(data.caseId);
              setChangeFeed(prev => [`${ts} — Case created`, ...prev].slice(0, 20));
              break;

            case "discrepancy_detected":
              updateAgent("casefile", { state: "reading", message: "⚠️ Discrepancy found!" });
              setCaseFacts(prev => {
                const entry = "⚠️ MISMATCH: invoice ≠ packing list";
                if (prev.includes(entry)) return prev;
                return [...prev, entry];
              });
              setChangeFeed(prev => [`${ts} — ⚠️ Discrepancy detected`, ...prev].slice(0, 20));
              setTimeout(() => updateAgent("casefile", { state: "idle", message: undefined }), 5000);
              break;

            case "computer_use_step":
              setAgentTemp("portal", "typing", data.step?.description ?? "Amending…", 2000);
              break;

            case "needs_confirmation":
              updateAgent("portal", { state: "waiting", message: "Awaiting approval…" });
              setApprovalPending(true);
              setChangeFeed(prev => [`${ts} — 🔒 Awaiting human approval`, ...prev].slice(0, 20));
              break;

            case "correction_submitted":
              updateAgent("portal", { state: "idle", message: undefined });
              setApprovalPending(false);
              setChangeFeed(prev => [`${ts} — ✅ Correction submitted`, ...prev].slice(0, 20));
              break;

            case "correction_rejected":
              updateAgent("portal", { state: "idle", message: undefined });
              setApprovalPending(false);
              setChangeFeed(prev => [`${ts} — ❌ Correction rejected`, ...prev].slice(0, 20));
              break;

            case "session_check":
              setChangeFeed(prev => [`${ts} — 🔍 Memory session check`, ...prev].slice(0, 20));
              break;

            case "order_changed":
              setChangeFeed(prev => [`${ts} — 📦 Order updated (v${data.version})`, ...prev].slice(0, 20));
              break;

            case "cleared":
              setChangeFeed(prev => [`${ts} — ✅ Container cleared`, ...prev].slice(0, 20));
              break;
          }
        } catch {}
      };
    };

    connect();
    return () => { wsRef.current?.close(); };
  }, []);

  // ── Approval handlers ──
  const handleApprove = async () => {
    if (!caseId) return;
    await fetch(`${API}/api/cases/${caseId}/confirm`, { method: "POST" });
  };

  const handleReject = async () => {
    if (!caseId) return;
    await fetch(`${API}/api/cases/${caseId}/reject`, { method: "POST" });
  };

  // ── Session registration ──
  const handleSetupSession = async () => {
    // Create a case first
    const res = await fetch(`${API}/api/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shipment: { ref: "SHIP-RESTART-001", origin: "Shenzhen, China", destination: "Hamburg, Germany", hsCode: "8541.40.90" } }),
    });
    const caseFile = await res.json();
    setCaseId(caseFile.caseId);

    // Register session
    await fetch(`${API}/api/session/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: caseFile.caseId, environmentId: caseFile.environmentId, orderRef: "SHIP-RESTART-001" }),
    });
    setSessionRegistered(true);
    setChangeFeed(prev => [`${new Date().toLocaleTimeString()} — Session registered for ${caseFile.caseId.slice(0, 8)}…`, ...prev].slice(0, 20));
  };

  // ── Session HUD polling ──
  useEffect(() => {
    if (!caseId || !sessionRegistered) return;
    const poll = async () => {
      try {
        const res = await fetch(`${API}/api/session/${caseId}/status`);
        const data = await res.json();
        if (!data.error) {
          setSessionStatus(data.status);
          setLastChecked(data.lastCheckedAt ?? null);
          setNextCheck(data.nextCheckAt ?? null);
        }
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => clearInterval(iv);
  }, [caseId, sessionRegistered]);

  // ── Countdown timer ──
  useEffect(() => {
    if (!nextCheck) { setCountdown(null); return; }
    const tick = () => {
      const diff = Math.max(0, Math.round((new Date(nextCheck).getTime() - Date.now()) / 1000));
      setCountdown(diff);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [nextCheck]);

  const handleCheckNow = async () => {
    if (!caseId) return;
    await fetch(`${API}/api/session/${caseId}/check-now`, { method: "POST" });
  };

  return (
    <div className="office-app live-mode">
      {/* Header */}
      <div className="live-header">
        <div className="live-header-left">
          <span className="live-logo">🛃</span>
          <h1 className="live-title">ClearBorder</h1>
          <span className="live-badge">LIVE</span>
        </div>
        <div className="live-header-right">
          <span className={`ws-indicator ${wsConnected ? "connected" : ""}`}>
            {wsConnected ? "● Connected" : "○ Disconnected"}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="live-content">
        {/* Office floor with agents */}
        <div className="live-office-floor">
          <div className="company-sign">
            <span>CLEARBORDER</span>
            <span className="sign-sub">Customs Intelligence</span>
          </div>
          <div className="office-floor">
            {agents.map(a => <AgentWorkstation key={a.id} agent={a} />)}
          </div>
        </div>

        {/* Side panel */}
        <div className="live-side-panel">
          {/* Session HUD */}
          <div className="session-hud">
            <div className="memory-header">
              🧠 <span style={{ color: "var(--accent)" }}>Memory Session</span>
            </div>
            {!sessionRegistered ? (
              <div className="hud-setup">
                <p className="memory-empty">No active session — register a case to start monitoring.</p>
                <button className="btn-setup" onClick={handleSetupSession}>🚀 Start Monitoring</button>
              </div>
            ) : (
              <div className="hud-active">
                <div className={`hud-status-indicator ${sessionStatus}`}>
                  <span className="hud-dot" />
                  <span className="hud-status-text">
                    {sessionStatus === "idle" ? "Idle" :
                     sessionStatus === "checking" ? "Checking…" :
                     sessionStatus === "reconciling" ? "Reconciling…" :
                     sessionStatus === "awaiting_approval" ? "⚠ Awaiting Approval" : sessionStatus}
                  </span>
                </div>
                <div className="hud-row">
                  <span className="hud-label">Last check:</span>
                  <span className="hud-value">{lastChecked ? new Date(lastChecked).toLocaleTimeString() : "—"}</span>
                </div>
                <div className="hud-row">
                  <span className="hud-label">Next check:</span>
                  <span className="hud-value">{countdown !== null ? `${countdown}s` : "—"}</span>
                </div>
                <button className="btn-check-now" onClick={handleCheckNow}>🔍 Check Now</button>
              </div>
            )}
          </div>

          {/* CaseFile Memory */}
          <div className="casefile-memory">
            <div className="memory-header">
              📁 <span style={{ color: "var(--accent)" }}>CaseFile Memory</span>
            </div>
            <div className="memory-subtitle">What ClearBorder remembers:</div>
            {caseFacts.length === 0 ? (
              <div className="memory-empty">No facts captured yet — waiting for events…</div>
            ) : (
              <div className="memory-facts">
                {caseFacts.map((f, i) => (
                  <div key={i} className={`memory-fact ${f.startsWith("⚠") ? "warning" : ""}`}>{f}</div>
                ))}
              </div>
            )}
          </div>

          {/* Approval Gate */}
          {approvalPending && (
            <div className="approval-gate">
              <div className="approval-title">⚠ Human Approval Required</div>
              <p className="approval-text">The Portal agent has prepared the correction. Approve to submit, or reject to cancel.</p>
              <div className="approval-buttons">
                <button className="approve-btn" onClick={handleApprove} id="approveLiveBtn">✓ Approve &amp; Submit</button>
                <button className="reject-btn" onClick={handleReject} id="rejectLiveBtn">✗ Reject</button>
              </div>
            </div>
          )}

          {/* Change Feed */}
          <div className="change-feed">
            <div className="memory-header">
              📋 <span style={{ color: "var(--accent)" }}>Activity Feed</span>
            </div>
            {changeFeed.length === 0 ? (
              <div className="memory-empty">No activity yet…</div>
            ) : (
              <div className="feed-entries">
                {changeFeed.map((entry, i) => (
                  <div key={i} className="feed-entry">{entry}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="live-footer">
        <span className="footer-status">
          {approvalPending ? "⚠ Approval" : "● Ready"}
        </span>
        <span className="footer-info">
          {caseId ? `Case: ${caseId.slice(0, 8)}…` : "No active case"}
        </span>
        <span className={`ws-dot ${wsConnected ? "connected" : ""}`}>
          {wsConnected ? "■ Live" : "□ Offline"}
        </span>
      </div>
    </div>
  );
}
