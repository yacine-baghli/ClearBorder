import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

// =====================================================
// ClearBorder Office — Pixel-Agents Visualization Shell
// =====================================================
// Three agents animate from real backend events:
//   🌐 Translator — Live Translate call activity
//   📁 Case-file  — CaseFile reads, discrepancy detection
//   🖥️ Portal     — Computer Use portal amendments
//
// WS events → agent state machine:
//   live_translate_active → Translator types
//   transcript            → Translator types
//   fact_captured         → Case-file reads
//   discrepancy_detected  → Case-file reads
//   computer_use_step     → Portal types
//   needs_confirmation    → Portal waiting (speech bubble)
//   day_closed            → all idle/sleep
//   resumed               → wake + walk to desks

const WS_URL = "ws://localhost:3001/ws";

type AgentState = "idle" | "walking" | "typing" | "reading" | "waiting" | "sleeping";

interface Agent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  state: AgentState;
  message?: string;
  color: string;
}

const INITIAL_AGENTS: Agent[] = [
  { id: "translator", name: "Translator", emoji: "🌐", role: "Live Translate", state: "idle", color: "#f59e0b" },
  { id: "casefile", name: "Case-file", emoji: "📁", role: "Persistence", state: "idle", color: "#3b82f6" },
  { id: "portal", name: "Portal", emoji: "🖥️", role: "Computer Use", state: "idle", color: "#10b981" },
];

// State label config
const STATE_LABELS: Record<AgentState, { label: string; icon: string }> = {
  idle: { label: "Idle", icon: "💤" },
  walking: { label: "Walking to desk", icon: "🚶" },
  typing: { label: "Working", icon: "⌨️" },
  reading: { label: "Analyzing", icon: "📖" },
  waiting: { label: "Waiting for input", icon: "⏳" },
  sleeping: { label: "Sleeping", icon: "😴" },
};

function App() {
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [wsConnected, setWsConnected] = useState(false);
  const [eventLog, setEventLog] = useState<Array<{ event: string; time: string; agent?: string }>>([]);
  const [dayInfo, setDayInfo] = useState<{ day: number; status: "active" | "closed" }>({ day: 1, status: "active" });
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll event log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [eventLog]);

  function updateAgent(id: string, updates: Partial<Agent>) {
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)));
  }

  function logEvent(event: string, agent?: string) {
    setEventLog((prev) => [
      ...prev.slice(-50), // keep last 50
      { event, time: new Date().toLocaleTimeString(), agent },
    ]);
  }

  // Auto-reset agent to idle after activity
  function setAgentTemporary(id: string, state: AgentState, message: string | undefined, durationMs: number) {
    updateAgent(id, { state, message });
    setTimeout(() => updateAgent(id, { state: "idle", message: undefined }), durationMs);
  }

  // WebSocket connection
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
          updateAgent("translator", { state: "typing", message: `Translating (${data.targetLanguage ?? "en"})` });
          logEvent("Call started — translating", "translator");
          break;

        case "transcript":
          setAgentTemporary("translator", "typing",
            data.direction === "in" ? "Listening…" : "Translating…", 2000);
          logEvent(`Transcript: "${(data.text ?? "").slice(0, 40)}…"`, "translator");
          break;

        case "live_translate_closed":
          updateAgent("translator", { state: "idle", message: undefined });
          logEvent("Call ended", "translator");
          break;

        case "fact_captured":
          setAgentTemporary("casefile", "reading", `Captured: ${data.docKind}`, 3000);
          logEvent(`Fact captured: ${data.docKind} = ${data.value}`, "casefile");
          break;

        case "case_created":
          setAgentTemporary("casefile", "typing", "New case file created", 2000);
          logEvent("New case created", "casefile");
          break;

        case "case_updated":
          setAgentTemporary("casefile", "reading", "Case updated", 1500);
          logEvent("Case file updated", "casefile");
          break;

        case "discrepancy_detected":
          updateAgent("casefile", { state: "reading", message: `⚠️ ${data.discrepancies?.length ?? 0} discrepancy(s) found!` });
          logEvent(`Discrepancy detected!`, "casefile");
          setTimeout(() => updateAgent("casefile", { state: "idle", message: undefined }), 5000);
          break;

        case "computer_use_step":
          setAgentTemporary("portal", "typing", `Amending: ${data.step?.action ?? "…"}`, 2000);
          logEvent("Portal amendment step", "portal");
          break;

        case "needs_confirmation":
          updateAgent("portal", { state: "waiting", message: "⏳ Waiting for human approval" });
          logEvent("Awaiting confirmation before submit", "portal");
          break;

        case "day_closed":
          setAgents((prev) => prev.map((a) => ({ ...a, state: "sleeping" as const, message: "💤 End of day" })));
          setDayInfo((prev) => ({ ...prev, status: "closed" }));
          logEvent("Day closed — all agents sleeping");
          break;

        case "resumed":
          setDayInfo({ day: data.day ?? 1, status: "active" });
          // Wake sequence: walking → typing
          setAgents((prev) => prev.map((a) => ({ ...a, state: "walking" as const, message: "☀️ Waking up…" })));
          logEvent(`Day ${data.day} — agents waking up`);
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
          <span className="office-subtitle">Agent Visualization Shell</span>
        </div>
        <div className="office-header-right">
          <span className={`office-day ${dayInfo.status}`}>
            Day {dayInfo.day} · {dayInfo.status === "active" ? "Active" : "Closed"}
          </span>
          <span className={`office-ws ${wsConnected ? "on" : "off"}`}>
            <span className="dot" />
            {wsConnected ? "Live" : "Offline"}
          </span>
        </div>
      </header>

      {/* Agent Grid */}
      <main className="office-main">
        <div className="agents-grid">
          {agents.map((agent) => (
            <div key={agent.id} className={`agent-card ${agent.state}`} style={{ "--agent-color": agent.color } as React.CSSProperties}>
              {/* Avatar */}
              <div className="agent-avatar">
                <span className="agent-emoji">{agent.emoji}</span>
                <div className={`agent-state-ring ${agent.state}`} />
              </div>

              {/* Name & Role */}
              <div className="agent-identity">
                <h2 className="agent-name">{agent.name}</h2>
                <span className="agent-role">{agent.role}</span>
              </div>

              {/* Status */}
              <div className={`agent-status ${agent.state}`}>
                <span className="status-icon">{STATE_LABELS[agent.state].icon}</span>
                <span className="status-text">{STATE_LABELS[agent.state].label}</span>
              </div>

              {/* Speech bubble */}
              {agent.message && (
                <div className="speech-bubble">
                  {agent.message}
                </div>
              )}

              {/* Activity animation */}
              {(agent.state === "typing" || agent.state === "reading") && (
                <div className="activity-bar">
                  <div className="activity-pulse" />
                </div>
              )}
            </div>
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
              <div className="event-empty">Waiting for backend events…</div>
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
