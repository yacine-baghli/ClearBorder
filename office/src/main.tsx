import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

// =====================================================
// ClearBorder Office — Pixel-Agents Visualization Shell
// =====================================================

const WS_URL = "ws://localhost:3001/ws";

type AgentState = "idle" | "walking" | "typing" | "reading" | "waiting" | "sleeping";

interface Agent {
  id: string;
  name: string;
  role: string;
  state: AgentState;
  message?: string;
  skinColor: string;
  shirtColor: string;
  deskX: number; // percent position on floor
  deskY: number;
}

const INITIAL_AGENTS: Agent[] = [
  { id: "translator", name: "Translator", role: "Live Translate", state: "idle", skinColor: "#ffd5a5", shirtColor: "#f59e0b", deskX: 15, deskY: 50 },
  { id: "casefile", name: "Case-file", role: "Persistence", state: "idle", skinColor: "#e8c9a0", shirtColor: "#3b82f6", deskX: 50, deskY: 50 },
  { id: "portal", name: "Portal", role: "Computer Use", state: "idle", skinColor: "#d4a574", shirtColor: "#10b981", deskX: 85, deskY: 50 },
];

const STATE_CONFIG: Record<AgentState, { label: string; glowColor: string }> = {
  idle: { label: "Idle", glowColor: "transparent" },
  walking: { label: "Walking", glowColor: "rgba(129, 140, 248, 0.4)" },
  typing: { label: "Working", glowColor: "rgba(16, 185, 129, 0.5)" },
  reading: { label: "Analyzing", glowColor: "rgba(59, 130, 246, 0.5)" },
  waiting: { label: "Awaiting Input", glowColor: "rgba(245, 158, 11, 0.5)" },
  sleeping: { label: "Sleeping", glowColor: "transparent" },
};

function PixelAgent({ agent }: { agent: Agent }) {
  const { state, skinColor, shirtColor } = agent;
  const isSleeping = state === "sleeping";
  const isActive = state === "typing" || state === "reading";
  const isWaiting = state === "waiting";
  const isWalking = state === "walking";

  return (
    <div
      className={`pixel-workstation ${state}`}
      style={{ left: `${agent.deskX}%`, top: `${agent.deskY}%` }}
    >
      {/* Glow under character when active */}
      {isActive && (
        <div className="agent-glow" style={{ background: STATE_CONFIG[state].glowColor }} />
      )}

      {/* Desk */}
      <div className="pixel-desk">
        <div className="desk-top" />
        <div className="desk-legs" />
        {/* Monitor */}
        <div className={`pixel-monitor ${isActive ? "on" : ""} ${isSleeping ? "off" : ""}`}>
          <div className="monitor-screen">
            {isActive && <div className="screen-lines" />}
            {isSleeping && <div className="screen-off" />}
          </div>
          <div className="monitor-stand" />
        </div>
      </div>

      {/* Character */}
      <div className={`pixel-character ${state}`}>
        {/* Shadow */}
        <div className="char-shadow" />

        {/* Body group */}
        <div className="char-body-group">
          {/* Head */}
          <div className="char-head" style={{ background: skinColor }}>
            {/* Hair */}
            <div className="char-hair" style={{ background: shirtColor }} />
            {/* Eyes */}
            <div className="char-eyes">
              <div className={`char-eye left ${isSleeping ? "closed" : ""}`} />
              <div className={`char-eye right ${isSleeping ? "closed" : ""}`} />
            </div>
          </div>

          {/* Torso */}
          <div className="char-torso" style={{ background: shirtColor }}>
            <div className="char-collar" style={{ background: skinColor }} />
          </div>

          {/* Arms */}
          <div className={`char-arms ${state}`}>
            <div className="char-arm left" style={{ background: shirtColor }} />
            <div className="char-arm right" style={{ background: shirtColor }} />
          </div>

          {/* Legs */}
          <div className={`char-legs ${state}`}>
            <div className="char-leg left" />
            <div className="char-leg right" />
          </div>
        </div>

        {/* ZZZ for sleeping */}
        {isSleeping && (
          <div className="zzz-container">
            <span className="zzz z1">z</span>
            <span className="zzz z2">z</span>
            <span className="zzz z3">Z</span>
          </div>
        )}

        {/* Waiting bubble */}
        {isWaiting && (
          <div className="wait-bubble">
            <span>?</span>
          </div>
        )}
      </div>

      {/* Chair */}
      <div className="pixel-chair" />

      {/* Name tag */}
      <div className="agent-nametag">
        <span className="nametag-name">{agent.name}</span>
        <span className={`nametag-status ${state}`}>{STATE_CONFIG[state].label}</span>
      </div>

      {/* Speech bubble */}
      {agent.message && (
        <div className="pixel-speech">
          {agent.message}
        </div>
      )}
    </div>
  );
}

function App() {
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [wsConnected, setWsConnected] = useState(false);
  const [eventLog, setEventLog] = useState<Array<{ event: string; time: string; agent?: string }>>([]);
  const [dayInfo, setDayInfo] = useState<{ day: number; status: "active" | "closed" }>({ day: 1, status: "active" });
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [eventLog]);

  function updateAgent(id: string, updates: Partial<Agent>) {
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)));
  }

  function logEvent(event: string, agent?: string) {
    setEventLog((prev) => [
      ...prev.slice(-50),
      { event, time: new Date().toLocaleTimeString(), agent },
    ]);
  }

  function setAgentTemporary(id: string, state: AgentState, message: string | undefined, durationMs: number) {
    updateAgent(id, { state, message });
    setTimeout(() => updateAgent(id, { state: "idle", message: undefined }), durationMs);
  }

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => {
        setWsConnected(false);
        setTimeout(connect, 2000);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          handleEvent(msg.event, msg.data);
        } catch { /* ignore */ }
      };
    }

    function handleEvent(event: string, data: any) {
      switch (event) {
        case "live_translate_active":
          updateAgent("translator", { state: "typing", message: "Translating…" });
          logEvent("Translator active", "translator");
          break;

        case "transcript":
          setAgentTemporary("translator", "typing",
            data.direction === "in" ? "Listening…" : "Translating…", 2000);
          logEvent(`"${(data.text ?? "").slice(0, 30)}…"`, "translator");
          break;

        case "live_translate_closed":
          updateAgent("translator", { state: "idle", message: undefined });
          logEvent("Call ended", "translator");
          break;

        case "fact_captured":
          setAgentTemporary("casefile", "reading", `Captured: ${data.docKind}`, 3000);
          logEvent(`Fact: ${data.docKind} = ${data.value}`, "casefile");
          break;

        case "case_created":
          setAgentTemporary("casefile", "typing", "New case created", 2000);
          logEvent("Case created", "casefile");
          break;

        case "case_updated":
          setAgentTemporary("casefile", "reading", "Updating case…", 1500);
          logEvent("Case updated", "casefile");
          break;

        case "discrepancy_detected":
          updateAgent("casefile", { state: "reading", message: `⚠️ Discrepancy found!` });
          logEvent("Discrepancy detected!", "casefile");
          setTimeout(() => updateAgent("casefile", { state: "idle", message: undefined }), 5000);
          break;

        case "computer_use_step":
          setAgentTemporary("portal", "typing", data.step?.description ?? "Amending…", 2000);
          logEvent(data.step?.description ?? "Portal step", "portal");
          break;

        case "needs_confirmation":
          updateAgent("portal", { state: "waiting", message: "Awaiting approval…" });
          logEvent("Waiting for human approval", "portal");
          break;

        case "correction_submitted":
          setAgentTemporary("portal", "typing", "✅ Submitted!", 3000);
          logEvent("Correction submitted", "portal");
          break;

        case "correction_rejected":
          updateAgent("portal", { state: "idle", message: undefined });
          logEvent("Correction rejected", "portal");
          break;

        case "day_closed":
          setAgents((prev) => prev.map((a) => ({ ...a, state: "sleeping" as const, message: "💤 End of day" })));
          setDayInfo((prev) => ({ ...prev, status: "closed" }));
          logEvent("Day closed — all sleeping");
          break;

        case "resumed":
          setDayInfo({ day: data.day ?? 1, status: "active" });
          setAgents((prev) => prev.map((a) => ({ ...a, state: "walking" as const, message: "☀️ Waking up…" })));
          logEvent(`Day ${data.day} — waking up`);
          setTimeout(() => {
            setAgents((prev) => prev.map((a) => ({ ...a, state: "idle" as const, message: undefined })));
          }, 2000);
          break;
      }
    }

    connect();
  }, []);

  return (
    <div className="office-app">
      {/* Header */}
      <header className="office-header">
        <div className="office-header-left">
          <h1>🏢 ClearBorder Office</h1>
          <span className="office-subtitle">Pixel Agent Visualization</span>
        </div>
        <div className="office-header-right">
          <span className={`office-day ${dayInfo.status}`}>
            Day {dayInfo.day} · {dayInfo.status === "active" ? "☀️ Active" : "🌙 Closed"}
          </span>
          <span className={`office-ws ${wsConnected ? "on" : "off"}`}>
            <span className="dot" />
            {wsConnected ? "Live" : "Offline"}
          </span>
        </div>
      </header>

      {/* Main */}
      <main className="office-main">
        {/* Office Floor */}
        <div className={`office-floor ${dayInfo.status}`}>
          {/* Floor grid */}
          <div className="floor-grid" />

          {/* Decorations */}
          <div className="office-decor plant-1">🌿</div>
          <div className="office-decor plant-2">🪴</div>
          <div className="office-decor coffee">☕</div>
          <div className="office-decor clock">🕐</div>

          {/* Company sign */}
          <div className="company-sign">
            <span>CLEARBORDER</span>
            <span className="sign-sub">Customs Intelligence</span>
          </div>

          {/* Agents at workstations */}
          {agents.map((agent) => (
            <PixelAgent key={agent.id} agent={agent} />
          ))}
        </div>

        {/* Event Log */}
        <div className="event-log">
          <div className="event-log-header">
            <span>📋 Event Log</span>
            <span className="event-count">{eventLog.length}</span>
          </div>
          <div className="event-log-feed" ref={logRef}>
            {eventLog.length === 0 ? (
              <div className="event-empty">Waiting for events…</div>
            ) : (
              eventLog.map((e, i) => (
                <div key={i} className="event-entry">
                  <span className="event-time">{e.time}</span>
                  {e.agent && <span className={`event-agent ${e.agent}`}>{e.agent}</span>}
                  <span className="event-text">{e.event}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
