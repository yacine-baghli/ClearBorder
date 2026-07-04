import { useState, useEffect, useRef, useCallback } from "react";

const API = "http://localhost:3001";
const WS_URL = "ws://localhost:3001/ws";

// --- Types ---
interface TranscriptEntry {
  direction: "in" | "out";
  text: string;
  timestamp: string;
}

interface DocEntry {
  value: string;
  source: "call" | "portal" | "upload";
}

interface Discrepancy {
  id: string;
  kind: string;
  detail: string;
  status: "open" | "amended" | "confirmed" | "submitted";
  openedAt: string;
}

interface CaseFile {
  caseId: string;
  environmentId: string;
  shipment: { ref: string; origin: string; destination: string; hsCode?: string };
  documents: Record<string, DocEntry | undefined>;
  discrepancies: Discrepancy[];
  corrections: Array<{ at: string; field: string; from?: string; to: string; by: string }>;
  lastTouchedAt: string;
  day: number;
}

type DocKind = "invoice" | "packing_list" | "hs_code" | "value_proof";

const DOC_LABELS: Record<DocKind, string> = {
  invoice: "Invoice Value",
  packing_list: "Packing List Value",
  hs_code: "HS Code",
  value_proof: "Value Proof",
};

const DOC_ICONS: Record<DocKind, string> = {
  invoice: "📄",
  packing_list: "📋",
  hs_code: "🏷️",
  value_proof: "🔐",
};

// --- Toast ---
interface Toast {
  id: number;
  type: "success" | "error" | "info";
  msg: string;
}

let toastCounter = 0;

export default function App() {
  const [caseFile, setCaseFile] = useState<CaseFile | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [isCallActive, setIsCallActive] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [targetLang, setTargetLang] = useState("en");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [captureModal, setCaptureModal] = useState<{
    open: boolean;
    text: string;
    docKind: DocKind;
    value: string;
  }>({ open: false, text: "", docKind: "invoice", value: "" });

  const feedRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // --- Toast helper ---
  const showToast = useCallback((type: Toast["type"], msg: string) => {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, type, msg }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  // --- WebSocket ---
  useEffect(() => {
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => {
        setWsConnected(false);
        setTimeout(connect, 2000); // reconnect
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          switch (msg.event) {
            case "transcript":
              setTranscripts((prev) => [...prev, {
                direction: msg.data.direction,
                text: msg.data.text,
                timestamp: msg.data.timestamp,
              }]);
              break;
            case "live_translate_active":
              setIsTranslating(true);
              break;
            case "live_translate_closed":
              setIsTranslating(false);
              setIsCallActive(false);
              break;
            case "fact_captured":
              showToast("success", `Captured ${DOC_LABELS[msg.data.docKind as DocKind] ?? msg.data.docKind}: ${msg.data.value}`);
              refreshCase();
              break;
            case "case_updated":
            case "discrepancy_detected":
              refreshCase();
              break;
          }
        } catch { /* ignore parse errors */ }
      };
    }

    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Auto-scroll transcript ---
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [transcripts]);

  // --- API helpers ---
  async function createCase() {
    const res = await fetch(`${API}/api/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shipment: {
          ref: "SHIP-2026-CBR-001",
          origin: "Shenzhen, China",
          destination: "Hamburg, Germany",
        },
      }),
    });
    const cf = await res.json();
    setCaseFile(cf);
    showToast("success", `Case created: ${cf.caseId.slice(0, 8)}…`);
    return cf;
  }

  async function refreshCase() {
    if (!caseFile) return;
    const res = await fetch(`${API}/api/cases/${caseFile.caseId}`);
    if (res.ok) {
      setCaseFile(await res.json());
    }
  }

  async function startCall() {
    let cf = caseFile;
    if (!cf) cf = await createCase();

    setIsCallActive(true);
    setTranscripts([]);

    // Start translate session
    await fetch(`${API}/api/translate/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: cf.caseId, targetLanguageCode: targetLang }),
    });

    // In demo mode, run the simulated call
    await fetch(`${API}/api/translate/demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: cf.caseId }),
    });

    showToast("info", "Demo call started — transcripts streaming");
  }

  async function endCall() {
    await fetch(`${API}/api/translate/close`, { method: "POST" });
    setIsCallActive(false);
    setIsTranslating(false);
    showToast("info", "Call ended");
  }

  async function captureAsFact() {
    if (!caseFile) return;
    const { docKind, value } = captureModal;
    if (!value.trim()) return;

    await fetch(`${API}/api/cases/${caseFile.caseId}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docKind, value: value.trim() }),
    });

    setCaptureModal({ open: false, text: "", docKind: "invoice", value: "" });
    await refreshCase();
  }

  async function detectDiscrepancies() {
    if (!caseFile) return;
    const res = await fetch(`${API}/api/cases/${caseFile.caseId}/discrepancies`, {
      method: "POST",
    });
    const data = await res.json();
    if (data.discrepancies?.length > 0) {
      showToast("info", `Found ${data.discrepancies.length} discrepancy(s)`);
    } else {
      showToast("success", "No new discrepancies");
    }
    await refreshCase();
  }

  // --- Format time ---
  function formatTime(ts: string): string {
    try {
      return new Date(ts).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return "";
    }
  }

  return (
    <div className="console-app">
      {/* ===== Header ===== */}
      <header className="console-header">
        <div className="header-left">
          <h1>ClearBorder</h1>
          {caseFile && (
            <span className="case-badge">
              📁 {caseFile.caseId.slice(0, 8)}…
            </span>
          )}
        </div>
        <div className="header-right">
          {caseFile && <span className="day-badge">Day {caseFile.day}</span>}
          {isTranslating && (
            <span className="live-indicator">
              <span className="dot" />
              LIVE
            </span>
          )}
          <span className={`status-badge ${wsConnected ? "connected" : "disconnected"}`}>
            <span className="status-dot" />
            {wsConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </header>

      {/* ===== Main Layout ===== */}
      <main className="console-main">
        {/* Left — Transcript */}
        <div className="transcript-panel">
          <div className="panel-header">
            <div className="panel-title">
              <span className="icon">🎙️</span>
              Live Translate — Call Transcript
            </div>
            <div className="panel-actions">
              <select
                className="language-select"
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                disabled={isCallActive}
              >
                <option value="en">English</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="es">Spanish</option>
                <option value="zh">Chinese</option>
                <option value="ar">Arabic</option>
              </select>
            </div>
          </div>

          {transcripts.length === 0 ? (
            <div className="transcript-empty">
              <span className="icon">🌐</span>
              <p>Start a call to see live translated transcripts</p>
            </div>
          ) : (
            <div className="transcript-feed" ref={feedRef}>
              {transcripts.map((t, i) => (
                <div key={i} className={`transcript-entry ${t.direction}`}>
                  <div className="transcript-avatar">
                    {t.direction === "in" ? "🇨🇳" : "🇬🇧"}
                  </div>
                  <div className="transcript-content">
                    <div className="transcript-meta">
                      <span className="transcript-speaker">
                        {t.direction === "in" ? "Shipper (Original)" : "Translation"}
                      </span>
                      <span className="transcript-time">{formatTime(t.timestamp)}</span>
                    </div>
                    <div className="transcript-text">{t.text}</div>
                  </div>
                  {/* Capture button on translated output */}
                  {t.direction === "out" && (
                    <button
                      className="btn"
                      style={{ fontSize: "0.7rem", padding: "0.25rem 0.5rem", flexShrink: 0 }}
                      onClick={() =>
                        setCaptureModal({
                          open: true,
                          text: t.text,
                          docKind: "invoice",
                          value: t.text,
                        })
                      }
                      title="Capture as fact"
                    >
                      📌 Capture
                    </button>
                  )}
                </div>
              ))}
              {isTranslating && (
                <div className="typing-indicator">
                  <div className="typing-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className="typing-label">Translating…</span>
                </div>
              )}
            </div>
          )}

          {/* Call Controls */}
          <div className="call-controls">
            {!isCallActive ? (
              <button className="btn primary" onClick={startCall} id="startCallBtn">
                <span className="icon">📞</span>
                Start Demo Call
              </button>
            ) : (
              <button className="btn danger" onClick={endCall} id="endCallBtn">
                <span className="icon">📵</span>
                End Call
              </button>
            )}
            {caseFile && (
              <button className="btn success" onClick={detectDiscrepancies} id="detectBtn">
                <span className="icon">🔍</span>
                Detect Discrepancies
              </button>
            )}
          </div>
        </div>

        {/* Right — CaseFile */}
        <div className="case-panel">
          <div className="panel-header">
            <div className="panel-title">
              <span className="icon">📁</span>
              CaseFile
            </div>
          </div>

          <div className="case-panel-content">
            {!caseFile ? (
              <div className="doc-empty">
                Start a call to create a CaseFile
              </div>
            ) : (
              <>
                {/* Shipment */}
                <div className="case-section">
                  <div className="case-section-title">Shipment</div>
                  <div className="shipment-card">
                    <div className="shipment-row">
                      <span className="shipment-label">Reference</span>
                      <span className="shipment-value">{caseFile.shipment.ref}</span>
                    </div>
                    <div className="shipment-row">
                      <span className="shipment-label">Origin</span>
                      <span className="shipment-value">{caseFile.shipment.origin}</span>
                    </div>
                    <div className="shipment-row">
                      <span className="shipment-label">Destination</span>
                      <span className="shipment-value">{caseFile.shipment.destination}</span>
                    </div>
                    {caseFile.shipment.hsCode && (
                      <div className="shipment-row">
                        <span className="shipment-label">HS Code</span>
                        <span className="shipment-value">{caseFile.shipment.hsCode}</span>
                      </div>
                    )}
                    <div className="shipment-row">
                      <span className="shipment-label">Environment ID</span>
                      <span className="shipment-value" style={{ fontSize: "0.65rem", fontFamily: "monospace" }}>
                        {caseFile.environmentId.slice(0, 12)}…
                      </span>
                    </div>
                  </div>
                </div>

                {/* Documents */}
                <div className="case-section">
                  <div className="case-section-title">
                    Documents ({Object.keys(caseFile.documents).filter((k) => caseFile.documents[k]).length})
                  </div>
                  {Object.keys(caseFile.documents).filter((k) => caseFile.documents[k]).length === 0 ? (
                    <div className="doc-empty">
                      No documents captured yet. Use "Capture" on a transcript.
                    </div>
                  ) : (
                    <div className="doc-list">
                      {(Object.entries(caseFile.documents) as [DocKind, DocEntry | undefined][])
                        .filter(([, v]) => v)
                        .map(([kind, doc]) => (
                          <div className="doc-item" key={kind}>
                            <div className="doc-icon">{DOC_ICONS[kind] ?? "📄"}</div>
                            <div className="doc-info">
                              <div className="doc-kind">{DOC_LABELS[kind] ?? kind}</div>
                              <div className="doc-value">{doc!.value}</div>
                              <div className="doc-source">Source: {doc!.source}</div>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                {/* Discrepancies */}
                {caseFile.discrepancies.length > 0 && (
                  <div className="case-section">
                    <div className="case-section-title">
                      ⚠️ Discrepancies ({caseFile.discrepancies.length})
                    </div>
                    <div className="discrepancy-list">
                      {caseFile.discrepancies.map((d) => (
                        <div className={`discrepancy-item ${d.status}`} key={d.id}>
                          <div className="discrepancy-kind">{d.kind.replace(/_/g, " ")}</div>
                          <div className="discrepancy-detail">{d.detail}</div>
                          <span className={`discrepancy-status ${d.status}`}>
                            {d.status === "open" ? "⚠ Open" : `✓ ${d.status}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Corrections */}
                {caseFile.corrections.length > 0 && (
                  <div className="case-section">
                    <div className="case-section-title">
                      Corrections ({caseFile.corrections.length})
                    </div>
                    <div className="doc-list">
                      {caseFile.corrections.map((c, i) => (
                        <div className="doc-item" key={i}>
                          <div className="doc-icon">✏️</div>
                          <div className="doc-info">
                            <div className="doc-kind">{c.field}</div>
                            <div className="doc-value">
                              {c.from && <span style={{ textDecoration: "line-through", color: "var(--error)", marginRight: "0.5rem" }}>{c.from}</span>}
                              → {c.to}
                            </div>
                            <div className="doc-source">By: {c.by} · {formatTime(c.at)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {/* ===== Capture Modal ===== */}
      {captureModal.open && (
        <div className="capture-overlay" onClick={() => setCaptureModal((m) => ({ ...m, open: false }))}>
          <div className="capture-modal" onClick={(e) => e.stopPropagation()}>
            <div className="capture-modal-header">
              <h3>📌 Capture as Fact</h3>
              <p>Save this transcript as a document value in the CaseFile</p>
            </div>
            <div className="capture-modal-body">
              <div className="capture-field">
                <label>Transcript</label>
                <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", fontStyle: "italic", padding: "0.5rem", background: "var(--bg-elevated)", borderRadius: "6px" }}>
                  "{captureModal.text}"
                </div>
              </div>
              <div className="capture-field">
                <label>Document Kind</label>
                <select
                  value={captureModal.docKind}
                  onChange={(e) =>
                    setCaptureModal((m) => ({ ...m, docKind: e.target.value as DocKind }))
                  }
                >
                  <option value="invoice">Invoice Value</option>
                  <option value="packing_list">Packing List Value</option>
                  <option value="hs_code">HS Code</option>
                  <option value="value_proof">Value Proof</option>
                </select>
              </div>
              <div className="capture-field">
                <label>Value to Store</label>
                <input
                  type="text"
                  value={captureModal.value}
                  onChange={(e) =>
                    setCaptureModal((m) => ({ ...m, value: e.target.value }))
                  }
                  placeholder="e.g. €47,250.00"
                />
              </div>
            </div>
            <div className="capture-modal-footer">
              <button
                className="btn"
                onClick={() => setCaptureModal((m) => ({ ...m, open: false }))}
              >
                Cancel
              </button>
              <button className="btn primary" onClick={captureAsFact} id="confirmCaptureBtn">
                <span className="icon">📌</span>
                Capture
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Toasts ===== */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === "success" && "✓"} {t.type === "error" && "✗"} {t.type === "info" && "ℹ"} {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
