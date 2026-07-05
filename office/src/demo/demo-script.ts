import { Beat } from "./types";

// =====================================================
// Demo Script — 11 beats across 7 scenes
// =====================================================
// Scenes 1-3: emotional setup (fast)
// Scene 4: THE PRODUCT (slow, agents work from real pipeline)
// Scenes 5-6: resolution

const DEMO_SCRIPT: Beat[] = [
  // ── Scene 0: Intro ──
  {
    id: 1, scene: 0, step: "Intro", actor: "—", type: "intro",
    payload: {
      title: "ClearBorder",
      body: "AI-powered customs clearance that chains Live Translate, a persistent CaseFile, and Computer Use into one agent pipeline — so shipments clear faster and nothing gets lost between days.",
      buttonLabel: "Start Demo",
    },
  },

  // ── Scene 1: Joan worried ──
  {
    id: 2, scene: 1, step: "Order stuck", actor: "Joan", type: "speech",
    autoAdvanceMs: 5000,
    payload: {
      character: "joan",
      text: "I ordered my France shirt for the World Cup… it still hasn't arrived!",
      emotion: "worried",
    },
  },
  {
    id: 3, scene: 1, step: "Order stuck", actor: "Joan", type: "speech",
    autoAdvanceMs: 4000,
    payload: {
      character: "joan",
      text: "The final is in days — I need it now.",
      emotion: "worried",
    },
  },

  // ── Scene 2: Joan emails seller ──
  {
    id: 4, scene: 2, step: "Customer alert", actor: "Joan", type: "emailSent",
    autoAdvanceMs: 5000,
    payload: {
      from: "Joan Martin",
      to: "SportStyle Retail",
      subject: "Where is my order #FR-2024-WC?",
      body: "Hi, I ordered a France World Cup shirt (order #FR-2024-WC) three weeks ago. The World Cup final is this Saturday and it still hasn't arrived. Can you please check what's happening? — Joan",
    },
  },

  // ── Scene 3: Retailer finds problem ──
  {
    id: 5, scene: 3, step: "Customs hold", actor: "Retailer", type: "containerStatus",
    autoAdvanceMs: 6000,
    payload: {
      status: "held",
      label: "🔴 Container CNIU-4821 — HELD at French Customs",
      retailerSpeech: "Invoice / packing-list value mismatch + missing HS code. I'm launching ClearBorder.",
    },
  },

  // ── Scene 4: ClearBorder takes over (THE CORE) ──
  {
    id: 6, scene: 4, step: "Live Translate", actor: "Translator", type: "pipeline",
    autoAdvanceMs: 10000,
    payload: {
      action: "translate",
      description: "Translator captures trade facts from supplier message",
    },
  },
  {
    id: 7, scene: 4, step: "Discrepancy", actor: "Case-file", type: "pipeline",
    autoAdvanceMs: 6000,
    payload: {
      action: "detect",
      description: "CaseFile detects: invoice €47,250 ≠ packing list €45,000",
    },
  },
  {
    id: 8, scene: 4, step: "Portal fix", actor: "Portal", type: "pipeline",
    // No autoAdvance — waits for Computer Use to finish
    payload: {
      action: "computerUse",
      description: "Portal agent corrects the declared value on the customs portal",
    },
  },
  {
    id: 9, scene: 4, step: "Approval", actor: "Operator", type: "waitForApproval",
    requiresApproval: true,
    payload: {
      prompt: "The Portal agent has prepared the correction. Approve to submit, or reject to cancel.",
    },
  },

  // ── Scene 5: Cleared ──
  {
    id: 10, scene: 5, step: "Cleared", actor: "—", type: "containerStatus",
    autoAdvanceMs: 4000,
    payload: {
      status: "cleared",
      label: "🟢 Container CNIU-4821 — CLEARED by French Customs",
    },
  },

  // ── Scene 6: Delivered ──
  {
    id: 11, scene: 6, step: "Delivered", actor: "Joan", type: "speech",
    payload: {
      character: "joan",
      text: "It arrived — just in time for the final! ⚽🇫🇷",
      emotion: "happy",
    },
  },
];

export default DEMO_SCRIPT;
