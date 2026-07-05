import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import DemoController, { DemoAPI } from "./demo/DemoController";
import { Beat, DemoState, SceneId } from "./demo/types";
import DEMO_SCRIPT from "./demo/demo-script";
import LiveMode from "./LiveMode";

// =====================================================
// ClearBorder Office — Demo Mode (Scene-based)
// =====================================================

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

const TIMELINE_STEPS = ["Order stuck", "Email sent", "Customs hold", "Live Translate", "Discrepancy", "Portal fix", "Cleared"];

// ── Pixel Character (reused for Joan, Retailer, and Agents) ──
function PixelChar({ skin, shirt, size = 1, sleeping = false }: { skin: string; shirt: string; size?: number; sleeping?: boolean }) {
  const s = (v: number) => v * size;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", transform: `scale(${size})` }}>
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

// ── Agent Workstation (pixel desk + character + monitor) ──
function AgentWorkstation({ agent }: { agent: Agent }) {
  const isActive = agent.state === "typing" || agent.state === "reading";
  const isSleeping = agent.state === "sleeping";
  const isWaiting = agent.state === "waiting";

  return (
    <div className={`pixel-workstation ${agent.state}`} style={{ left: `${agent.deskX}%`, top: `${agent.deskY}%` }}>
      {isActive && <div className="agent-glow" style={{ background: "rgba(59,130,246,0.4)" }} />}
      <div className="pixel-desk">
        <div className="desk-top" />
        <div className="desk-legs" />
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

// ── Scene Components ──

function SceneIntro({ beat, onStart }: { beat: any; onStart: () => void }) {
  return (
    <div className="scene-panel scene-intro">
      <div className="intro-card">
        <div className="intro-icon">🛃</div>
        <h1 className="intro-title">{beat.payload.title}</h1>
        <p className="intro-body">{beat.payload.body}</p>
        <button className="intro-btn" onClick={onStart} id="startDemoBtn">
          {beat.payload.buttonLabel} →
        </button>
      </div>
    </div>
  );
}

function SceneJoan({ beat }: { beat: any }) {
  const isHappy = beat.payload?.emotion === "happy";
  return (
    <div className="scene-panel scene-joan">
      <div className="scene-title-bar">Scene {beat.scene}: {isHappy ? "Delivered!" : "The Stuck Order"}</div>
      <div className="scene-content">
        <div className="joan-area">
          <div className="joan-character">
            <PixelChar skin="#ffdbac" shirt={isHappy ? "#10b981" : "#e74c3c"} size={3} />
            <div className="joan-label">Joan</div>
          </div>
          {isHappy && <div className="joan-shirt">🇫🇷 ⚽</div>}
        </div>
        <div className={`speech-card ${beat.payload?.emotion ?? "neutral"}`}>
          <div className="speech-card-avatar">👩</div>
          <div className="speech-card-text">"{beat.payload.text}"</div>
        </div>
      </div>
    </div>
  );
}

function SceneEmail({ beat }: { beat: any }) {
  return (
    <div className="scene-panel scene-email">
      <div className="scene-title-bar">Scene 2: Joan Emails the Seller</div>
      <div className="scene-content">
        <div className="email-layout">
          <div className="joan-area">
            <PixelChar skin="#ffdbac" shirt="#e74c3c" size={2.5} />
            <div className="joan-label">Joan</div>
          </div>
          <div className="email-arrow">✉️ →</div>
          <div className="email-popup">
            <div className="email-header-bar">
              <span className="email-dot red" /><span className="email-dot yellow" /><span className="email-dot green" />
              <span className="email-title-text">New Message</span>
            </div>
            <div className="email-field"><strong>From:</strong> {beat.payload.from}</div>
            <div className="email-field"><strong>To:</strong> {beat.payload.to}</div>
            <div className="email-field"><strong>Subject:</strong> {beat.payload.subject}</div>
            <div className="email-body-text">{beat.payload.body}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SceneRetailer({ beat }: { beat: any }) {
  const isCleared = beat.payload.status === "cleared";
  return (
    <div className="scene-panel scene-retailer">
      <div className="scene-title-bar">Scene {isCleared ? 5 : 3}: {isCleared ? "Cleared!" : "The Retailer Finds the Problem"}</div>
      <div className="scene-content">
        <div className="retailer-layout">
          {!isCleared && (
            <div className="retailer-area">
              <PixelChar skin="#d4a574" shirt="#2c3e50" size={2.5} />
              <div className="joan-label">Retailer</div>
            </div>
          )}
          <div className={`container-card ${beat.payload.status}`}>
            <div className="container-icon">{isCleared ? "🟢" : "🔴"}</div>
            <div className="container-id">Container CNIU-4821</div>
            <div className="container-contents">📦 2,400× France World Cup Shirts</div>
            <div className="container-status">{beat.payload.label}</div>
            {!isCleared && (
              <div className="container-details">
                <div>⚠️ Invoice value: €47,250.00</div>
                <div>⚠️ Packing list: €45,000.00</div>
                <div>⚠️ HS Code: missing</div>
              </div>
            )}
          </div>
        </div>
        {beat.payload.retailerSpeech && (
          <div className="speech-card neutral" style={{ marginTop: "1.5rem" }}>
            <div className="speech-card-avatar">👔</div>
            <div className="speech-card-text">"{beat.payload.retailerSpeech}"</div>
          </div>
        )}
      </div>
    </div>
  );
}

function SceneOffice({ agents, beat, caseFacts, demoState, onApprove, onReject }: {
  agents: Agent[]; beat: Beat | null; caseFacts: string[];
  demoState: DemoState; onApprove: () => void; onReject: () => void;
}) {
  return (
    <div className="scene-panel scene-office">
      <div className="scene-title-bar">Scene 4: ClearBorder Takes Over</div>
      <div className="office-scene-layout">
        {/* Office floor with agents */}
        <div className="office-floor active">
          <div className="floor-grid" />
          <div className="company-sign"><span>CLEARBORDER</span><span className="sign-sub">Customs Intelligence</span></div>
          {agents.map((a) => <AgentWorkstation key={a.id} agent={a} />)}
        </div>

        {/* CaseFile memory panel — "visibly remembers" */}
        <div className="casefile-memory">
          <div className="memory-header">📁 CaseFile Memory</div>
          <div className="memory-subtitle">What ClearBorder remembers:</div>
          {caseFacts.length === 0 ? (
            <div className="memory-empty">Waiting for facts…</div>
          ) : (
            <div className="memory-facts">
              {caseFacts.map((f, i) => (
                <div key={i} className="memory-fact">{f}</div>
              ))}
            </div>
          )}

          {/* Approval buttons in Scene 4 */}
          {demoState === "waitingApproval" && (
            <div className="approval-gate">
              <div className="approval-title">⚠️ Human Approval Required</div>
              <div className="approval-prompt">{beat?.type === "waitForApproval" ? (beat as any).payload.prompt : ""}</div>
              <div className="approval-buttons">
                <button className="stage-btn approve" onClick={onApprove} id="demoApproveBtn">✓ Approve & Submit</button>
                <button className="stage-btn reject" onClick={onReject} id="demoRejectBtn">✗ Reject</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Timeline Bar ──
const STEP_MAP: Record<string, number> = {
  "Order stuck": 0, "Customer alert": 1, "Customs hold": 2,
  "Live Translate": 3, "Discrepancy": 4, "Portal fix": 5, "Approval": 5,
  "Cleared": 6, "Delivered": 6, "Intro": -1,
};

function TimelineBar({ currentBeat, demoState }: { currentBeat: Beat | null; demoState: DemoState }) {
  const stepIdx = currentBeat ? (STEP_MAP[currentBeat.step] ?? -1) : -1;
  const progress = demoState === "complete" ? 100 : currentBeat ? Math.min(100, ((currentBeat.id) / DEMO_SCRIPT.length) * 100) : 0;

  return (
    <div className="timeline-bar">
      <div className="timeline-progress" style={{ width: `${progress}%` }} />
      <div className="timeline-steps">
        {TIMELINE_STEPS.map((step, i) => (
          <div key={step} className={`timeline-step ${i <= stepIdx ? "active" : ""} ${i === stepIdx ? "current" : ""}`}>
            <div className="step-dot" />
            <span className="step-label">{step}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// =====================================================
// Main App
// =====================================================

function App() {
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [wsConnected, setWsConnected] = useState(false);
  const demoRef = useRef<DemoAPI | null>(null);
  const [demoBeat, setDemoBeat] = useState<Beat | null>(null);
  const [demoBeatIndex, setDemoBeatIndex] = useState(-1);
  const [demoState, setDemoState] = useState<DemoState>("idle");
  const [caseFacts, setCaseFacts] = useState<string[]>([]);

  const currentScene: SceneId | -1 = demoBeat?.scene ?? -1;

  const handleBeatChange = useCallback((beat: Beat, index: number) => {
    setDemoBeat(beat);
    setDemoBeatIndex(index);
  }, []);

  const handleDemoStateChange = useCallback((state: DemoState) => {
    setDemoState(state);
  }, []);

  // Agent updates
  function updateAgent(id: string, updates: Partial<Agent>) {
    setAgents(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  }
  function setAgentTemp(id: string, state: AgentState, message: string | undefined, ms: number) {
    updateAgent(id, { state, message });
    setTimeout(() => updateAgent(id, { state: "idle", message: undefined }), ms);
  }

  // WebSocket — agents animate from REAL events
  useEffect(() => {
    function connect() {
      const ws = new WebSocket(WS_URL);
      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => { setWsConnected(false); setTimeout(connect, 2000); };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          const { event, data } = msg;
          switch (event) {
            case "fact_captured":
              setAgentTemp("casefile", "reading", `Captured: ${data.docKind}`, 3000);
              setCaseFacts(prev => {
                const entry = `${data.docKind}: ${data.value}`;
                if (prev.includes(entry)) return prev; // deduplicate
                return [...prev, entry];
              });
              break;
            case "case_created":
              setAgentTemp("casefile", "typing", "New case created", 2000);
              break;
            case "discrepancy_detected":
              updateAgent("casefile", { state: "reading", message: "⚠️ Discrepancy found!" });
              setCaseFacts(prev => {
                const entry = "⚠️ MISMATCH: invoice ≠ packing list";
                if (prev.includes(entry)) return prev; // deduplicate
                return [...prev, entry];
              });
              setTimeout(() => updateAgent("casefile", { state: "idle", message: undefined }), 5000);
              break;
            case "computer_use_step":
              setAgentTemp("portal", "typing", data.step?.description ?? "Amending…", 2000);
              break;
            case "needs_confirmation":
              updateAgent("portal", { state: "waiting", message: "Awaiting approval…" });
              break;
            case "correction_submitted":
              setAgentTemp("portal", "typing", "✅ Submitted!", 3000);
              setCaseFacts(prev => [...prev, "✅ Correction submitted (by: human)"]);
              break;
            case "correction_rejected":
              updateAgent("portal", { state: "idle", message: undefined });
              break;
            case "case_updated":
              setAgentTemp("casefile", "reading", "Updating…", 1500);
              break;
          }
        } catch {}
      };
    }
    connect();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") { e.preventDefault(); demoState === "playing" ? demoRef.current?.pause() : demoRef.current?.play(); }
      if (e.code === "ArrowRight") { e.preventDefault(); demoRef.current?.next(); }
      if (e.code === "KeyR" && e.shiftKey) { e.preventDefault(); demoRef.current?.reset(); setDemoBeat(null); setCaseFacts([]); setAgents(INITIAL_AGENTS); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [demoState]);

  // Reset handler
  const handleReset = useCallback(() => {
    demoRef.current?.reset();
    setDemoBeat(null);
    setDemoBeatIndex(-1);
    setCaseFacts([]);
    setAgents(INITIAL_AGENTS);
  }, []);

  // ── Render ──
  return (
    <div className="office-app">
      {/* Timeline */}
      {currentScene >= 1 && <TimelineBar currentBeat={demoBeat} demoState={demoState} />}

      {/* Scene router */}
      <main className="scene-container">
        {/* Idle / not started */}
        {currentScene === -1 && (
          <div className="scene-panel scene-intro">
            <div className="intro-card">
              <div className="intro-icon">🛃</div>
              <h1 className="intro-title">ClearBorder</h1>
              <p className="intro-body">AI-powered customs clearance — Live Translate, persistent CaseFile, and Computer Use in one agent pipeline.</p>
              <button className="intro-btn" onClick={() => demoRef.current?.play()} id="startDemoBtn">Start Demo →</button>
            </div>
          </div>
        )}

        {/* Scene 0: Intro */}
        {currentScene === 0 && demoBeat?.type === "intro" && (
          <SceneIntro beat={demoBeat} onStart={() => demoRef.current?.next()} />
        )}

        {/* Scene 1: Joan worried + Scene 6: Joan happy */}
        {(currentScene === 1 || currentScene === 6) && demoBeat?.type === "speech" && (
          <SceneJoan beat={demoBeat} />
        )}

        {/* Scene 2: Email */}
        {currentScene === 2 && demoBeat?.type === "emailSent" && (
          <SceneEmail beat={demoBeat} />
        )}

        {/* Scene 3: Retailer + red container / Scene 5: green container */}
        {(currentScene === 3 || currentScene === 5) && demoBeat?.type === "containerStatus" && (
          <SceneRetailer beat={demoBeat} />
        )}

        {/* Scene 4: THE OFFICE — the product */}
        {currentScene === 4 && (
          <SceneOffice
            agents={agents}
            beat={demoBeat}
            caseFacts={caseFacts}
            demoState={demoState}
            onApprove={() => demoRef.current?.onApproved()}
            onReject={() => demoRef.current?.onRejected()}
          />
        )}
      </main>

      {/* Stage Controls */}
      <footer className="stage-controls">
        <div className="stage-left">
          <span className={`stage-state ${demoState}`}>
            {demoState === "idle" && "⏸ Ready"}
            {demoState === "playing" && "▶ Playing"}
            {demoState === "paused" && "⏸ Paused"}
            {demoState === "waitingApproval" && "⏳ Approval"}
            {demoState === "complete" && "✅ Complete"}
          </span>
          {demoBeat && <span className="demo-beat-badge">Beat {demoBeat.id}/11</span>}
        </div>
        <div className="stage-center">
          <button className="stage-btn" onClick={() => demoRef.current?.play()} disabled={demoState === "playing" || demoState === "waitingApproval" || demoState === "complete"}>▶ Play</button>
          <button className="stage-btn" onClick={() => demoRef.current?.pause()} disabled={demoState !== "playing"}>⏸ Pause</button>
          <button className="stage-btn primary" onClick={() => demoRef.current?.next()} disabled={demoState === "waitingApproval" || demoState === "complete"}>⏭ Next</button>
          <button className="stage-btn danger" onClick={handleReset}>↺ Reset</button>
        </div>
        <div className="stage-right">
          <span className={`office-ws ${wsConnected ? "on" : "off"}`}>
            <span className="dot" />{wsConnected ? "Live" : "Offline"}
          </span>
        </div>
      </footer>

      {/* Demo Controller (logic-only) */}
      <DemoController controllerRef={demoRef} onBeatChange={handleBeatChange} onStateChange={handleDemoStateChange} />
    </div>
  );
}

// ── Mode Router ──
function Root() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  if (mode === "live") return <LiveMode />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><Root /></React.StrictMode>
);
