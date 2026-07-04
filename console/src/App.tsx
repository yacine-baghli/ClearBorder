import { useState, useEffect, useRef, useCallback } from "react";

const API = "http://localhost:3001";
const WS_URL = "ws://localhost:3001/ws";

// --- Types ---
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
  openQueries: Array<{ id: string; question: string; answer?: string; status: string }>;
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

// --- Pre-loaded sender message (the "email") ---
interface SenderMessage {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  date: string;
  originalLang: string;
  body: string;
  translatedBody: string;
  extractableData: Array<{
    label: string;
    value: string;
    docKind: DocKind;
    highlight: string; // text to highlight in the body
  }>;
}

const SENDER_MESSAGE: SenderMessage = {
  id: "msg-001",
  from: "Li Wei (丽维太阳能科技)",
  fromEmail: "li.wei@solartech-shenzhen.cn",
  subject: "RE: Shipment SHIP-2026-CBR-001 — Invoice & Packing Details",
  date: "2026-07-04T14:32:00Z",
  originalLang: "zh-CN",
  body: `尊敬的合作伙伴，

关于运单 SHIP-2026-CBR-001，请查收以下贸易文件信息：

发票金额：47,250.00 欧元（含 CIF 运费）
装箱单金额：45,000.00 欧元（FOB 出厂价）
HS 编码：8541.40.90（单晶硅光伏面板，400W 组件）

请注意：发票金额包含了从深圳到汉堡的 CIF 运费（2,250 欧元），因此高于装箱单金额。

如需进一步文件，请告知。

此致敬礼,
李维
丽维太阳能科技有限公司
中国深圳`,
  translatedBody: `Dear Partner,

Regarding shipment SHIP-2026-CBR-001, please find the trade document information below:

**Invoice value: €47,250.00** (including CIF freight charges)
**Packing list value: €45,000.00** (FOB ex-works price)
**HS Code: 8541.40.90** (Monocrystalline silicon PV panels, 400W modules)

Please note: The invoice value includes CIF freight from Shenzhen to Hamburg (€2,250), hence it is higher than the packing list value.

If you need further documentation, please let me know.

Best regards,
Li Wei
SolarTech Shenzhen Ltd.
Shenzhen, China`,
  extractableData: [
    {
      label: "Invoice Value",
      value: "€47,250.00",
      docKind: "invoice",
      highlight: "Invoice value: €47,250.00",
    },
    {
      label: "Packing List Value",
      value: "€45,000.00",
      docKind: "packing_list",
      highlight: "Packing list value: €45,000.00",
    },
    {
      label: "HS Code",
      value: "8541.40.90",
      docKind: "hs_code",
      highlight: "HS Code: 8541.40.90",
    },
  ],
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
  const [messageLoaded, setMessageLoaded] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [captureModal, setCaptureModal] = useState<{
    open: boolean;
    text: string;
    docKind: DocKind;
    value: string;
  }>({ open: false, text: "", docKind: "invoice", value: "" });
  const [confirmCard, setConfirmCard] = useState<{
    open: boolean;
    caseId: string;
    discrepancyId: string;
    field: string;
    fieldLabel: string;
    from: string;
    to: string;
    message: string;
  } | null>(null);
  const [isCorrecing, setIsCorrecing] = useState(false);

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
        setTimeout(connect, 2000);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          switch (msg.event) {
            case "fact_captured":
              showToast("success", `Captured ${DOC_LABELS[msg.data.docKind as DocKind] ?? msg.data.docKind}: ${msg.data.value}`);
              refreshCase();
              break;
            case "case_updated":
            case "discrepancy_detected":
              refreshCase();
              break;
            case "needs_confirmation":
              setIsCorrecing(false);
              setConfirmCard({
                open: true,
                caseId: msg.data.caseId,
                discrepancyId: msg.data.discrepancyId,
                field: msg.data.correction.field,
                fieldLabel: msg.data.correction.fieldLabel,
                from: msg.data.correction.from,
                to: msg.data.correction.to,
                message: msg.data.message,
              });
              break;
            case "correction_submitted":
              showToast("success", `Correction submitted: ${msg.data.correction.field}`);
              setConfirmCard(null);
              refreshCase();
              break;
            case "correction_rejected":
              showToast("info", "Correction rejected — nothing was submitted");
              setConfirmCard(null);
              refreshCase();
              break;
            case "computer_use_step":
              showToast("info", `🖥️ ${msg.data.step.description}`);
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

  async function loadMessage() {
    let cf = caseFile;
    if (!cf) cf = await createCase();
    setMessageLoaded(true);
    showToast("info", "📧 Sender message loaded — extract key facts below");
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

  async function quickCapture(data: typeof SENDER_MESSAGE.extractableData[0]) {
    if (!caseFile) return;
    await fetch(`${API}/api/cases/${caseFile.caseId}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docKind: data.docKind, value: data.value }),
    });
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

  // --- Computer Use ---
  async function fixWithAgent(discrepancyId: string) {
    if (!caseFile) return;
    setIsCorrecing(true);
    showToast("info", "🖥️ Starting Computer Use agent…");
    await fetch(`${API}/api/cases/${caseFile.caseId}/correct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discrepancyId }),
    });
  }

  async function approveCorrection() {
    if (!confirmCard) return;
    await fetch(`${API}/api/cases/${confirmCard.caseId}/confirm`, {
      method: "POST",
    });
    await refreshCase();
  }

  async function rejectCorrection() {
    if (!confirmCard) return;
    await fetch(`${API}/api/cases/${confirmCard.caseId}/reject`, {
      method: "POST",
    });
    setConfirmCard(null);
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

  function formatDate(ts: string): string {
    try {
      return new Date(ts).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
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
          <span className={`status-badge ${wsConnected ? "connected" : "disconnected"}`}>
            <span className="status-dot" />
            {wsConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </header>

      {/* ===== Main Layout ===== */}
      <main className="console-main">
        {/* Left — Sender Message */}
        <div className="transcript-panel">
          <div className="panel-header">
            <div className="panel-title">
              <span className="icon">📧</span>
              Sender Communication
            </div>
            {messageLoaded && (
              <div className="panel-actions">
                <button
                  className={`btn ${showOriginal ? "primary" : ""}`}
                  style={{ fontSize: "0.65rem", padding: "0.2rem 0.5rem" }}
                  onClick={() => setShowOriginal(!showOriginal)}
                >
                  {showOriginal ? "🇬🇧 Show Translation" : "🇨🇳 Show Original"}
                </button>
              </div>
            )}
          </div>

          {!messageLoaded ? (
            <div className="transcript-empty">
              <span className="icon">📧</span>
              <p>Load a sender message to start building a CaseFile</p>
            </div>
          ) : (
            <div className="message-view">
              {/* Email header */}
              <div className="message-header">
                <div className="message-from">
                  <span className="message-avatar">🇨🇳</span>
                  <div>
                    <div className="message-sender">{SENDER_MESSAGE.from}</div>
                    <div className="message-email">{SENDER_MESSAGE.fromEmail}</div>
                  </div>
                </div>
                <div className="message-date">{formatDate(SENDER_MESSAGE.date)}</div>
              </div>
              <div className="message-subject">
                {SENDER_MESSAGE.subject}
              </div>

              {/* Email body */}
              <div className="message-body">
                {showOriginal ? (
                  <pre className="message-original">{SENDER_MESSAGE.body}</pre>
                ) : (
                  <div className="message-translated">
                    {SENDER_MESSAGE.translatedBody.split("\n").map((line, i) => {
                      // Bold lines with **
                      if (line.startsWith("**") && line.endsWith("**")) {
                        const inner = line.slice(2, -2);
                        return (
                          <p key={i} className="message-highlight">
                            {inner}
                          </p>
                        );
                      }
                      if (line.trim() === "") return <br key={i} />;
                      return <p key={i}>{line}</p>;
                    })}
                  </div>
                )}
              </div>

              {/* Extractable Data — Quick Capture */}
              <div className="extract-section">
                <div className="extract-title">📌 Extractable Data</div>
                <div className="extract-grid">
                  {SENDER_MESSAGE.extractableData.map((d) => {
                    const alreadyCaptured = caseFile?.documents[d.docKind];
                    return (
                      <div className={`extract-card ${alreadyCaptured ? "captured" : ""}`} key={d.docKind}>
                        <div className="extract-label">{d.label}</div>
                        <div className="extract-value">{d.value}</div>
                        {alreadyCaptured ? (
                          <span className="extract-badge captured">✓ Captured</span>
                        ) : (
                          <button
                            className="btn primary"
                            style={{ fontSize: "0.65rem", padding: "0.2rem 0.5rem" }}
                            onClick={() => quickCapture(d)}
                            id={`capture-${d.docKind}`}
                          >
                            📌 Capture
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="call-controls">
            {!messageLoaded ? (
              <button className="btn primary" onClick={loadMessage} id="loadMessageBtn">
                <span className="icon">📧</span>
                Load Sender Message
              </button>
            ) : (
              <button
                className="btn"
                onClick={() => {
                  // Capture all remaining data at once
                  const uncaptured = SENDER_MESSAGE.extractableData.filter(
                    (d) => !caseFile?.documents[d.docKind]
                  );
                  uncaptured.forEach((d) => quickCapture(d));
                }}
                id="captureAllBtn"
                disabled={SENDER_MESSAGE.extractableData.every(
                  (d) => caseFile?.documents[d.docKind]
                )}
              >
                <span className="icon">📌</span>
                Capture All Facts
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
                Load a sender message to start building a CaseFile
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
                      No documents captured yet. Use "Capture" on the sender message.
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
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.375rem" }}>
                            <span className={`discrepancy-status ${d.status}`}>
                              {d.status === "open" ? "⚠ Open" : `✓ ${d.status}`}
                            </span>
                            {d.status === "open" && (
                              <button
                                className="btn primary"
                                style={{ fontSize: "0.65rem", padding: "0.2rem 0.5rem" }}
                                onClick={() => fixWithAgent(d.id)}
                                disabled={isCorrecing}
                                id={`fixBtn-${d.id}`}
                              >
                                {isCorrecing ? "🖥️ Agent working…" : "🖥️ Fix with Agent"}
                              </button>
                            )}
                          </div>
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
              <p>Save this data as a document value in the CaseFile</p>
            </div>
            <div className="capture-modal-body">
              <div className="capture-field">
                <label>Source Text</label>
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

      {/* ===== Confirm Card ===== */}
      {confirmCard && (
        <div className="capture-overlay">
          <div className="capture-modal" style={{ maxWidth: "480px" }}>
            <div className="capture-modal-header" style={{ background: "rgba(245, 158, 11, 0.08)", borderBottom: "1px solid rgba(245, 158, 11, 0.2)" }}>
              <h3>⚠️ Human Confirmation Required</h3>
              <p>{confirmCard.message}</p>
            </div>
            <div className="capture-modal-body">
              <div className="capture-field">
                <label>Proposed Correction</label>
                <div style={{ padding: "0.75rem", background: "var(--bg-elevated)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.375rem" }}>
                    Field: <strong style={{ color: "var(--accent-light)" }}>{confirmCard.fieldLabel}</strong>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", fontSize: "0.9rem" }}>
                    <span style={{ textDecoration: "line-through", color: "var(--error)", opacity: 0.8 }}>{confirmCard.from}</span>
                    <span style={{ color: "var(--text-muted)" }}>→</span>
                    <span style={{ color: "var(--success)", fontWeight: 600 }}>{confirmCard.to}</span>
                  </div>
                </div>
              </div>
              <div style={{ padding: "0.75rem", background: "rgba(245, 158, 11, 0.06)", borderRadius: "8px", border: "1px solid rgba(245, 158, 11, 0.15)", fontSize: "0.78rem", color: "var(--warning)" }}>
                ⚠️ The Computer Use agent has filled the correction in the portal but has <strong>NOT submitted</strong> the declaration. Only your explicit approval will trigger submission.
              </div>
            </div>
            <div className="capture-modal-footer">
              <button className="btn danger" onClick={rejectCorrection} id="rejectCorrectionBtn">
                ✗ Reject
              </button>
              <button className="btn success" onClick={approveCorrection} id="approveCorrectionBtn">
                ✓ Approve &amp; Submit
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
