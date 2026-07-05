// server/src/computer-use.ts
// =====================================================================
// Computer Use Correction Engine
// =====================================================================
// Drives the mock customs portal to amend flagged entries.
// HARD RULE: the amendEntry() loop MUST halt before clicking Submit
// and emit a needs_confirmation event. confirmSubmit() is a SEPARATE
// function only reachable via explicit human approval.
//
// Two modes:
//   - Demo mode (default): Simulates actions with delays, emits WS events
//   - Live mode: Playwright + Gemini 2.5 Computer Use (screenshot→action)
// =====================================================================

import { broadcast } from "./events.js";
import type { CaseFile, Discrepancy } from "@clearborder/core";

// --- Types ---

export interface CorrectionStep {
  action: "navigate" | "click" | "clear" | "type" | "scroll" | "submit" | "halt";
  target?: string;
  value?: string;
  description: string;
}

export interface PendingCorrection {
  caseId: string;
  discrepancyId: string;
  discrepancy: Discrepancy;
  field: string;
  from: string;
  to: string;
  steps: CorrectionStep[];
  status: "amending" | "awaiting_confirmation" | "confirmed" | "rejected";
  createdAt: string;
}

// --- In-memory pending corrections (one per case for demo simplicity) ---
const pendingCorrections = new Map<string, PendingCorrection>();

/**
 * Start a Computer Use correction for an open discrepancy.
 * This is the entry point — triggered by POST /api/cases/:caseId/correct.
 */
export async function startCorrection(
  caseFile: CaseFile,
  discrepancyId: string
): Promise<PendingCorrection> {
  const discrepancy = caseFile.discrepancies.find((d) => d.id === discrepancyId);
  if (!discrepancy) throw new Error(`Discrepancy ${discrepancyId} not found`);
  if (discrepancy.status !== "open") throw new Error(`Discrepancy is not open (status: ${discrepancy.status})`);

  // Determine the correction based on discrepancy kind
  const correction = determineCorrectionFromDiscrepancy(caseFile, discrepancy);

  const pending: PendingCorrection = {
    caseId: caseFile.caseId,
    discrepancyId,
    discrepancy,
    field: correction.field,
    from: correction.from,
    to: correction.to,
    steps: [],
    status: "amending",
    createdAt: new Date().toISOString(),
  };

  pendingCorrections.set(caseFile.caseId, pending);

  // Run the amendment loop (demo mode — simulated steps)
  await amendEntry(pending);

  return pending;
}

/**
 * Determine what field to correct and what the corrected value should be.
 */
function determineCorrectionFromDiscrepancy(
  caseFile: CaseFile,
  discrepancy: Discrepancy
): { field: string; from: string; to: string } {
  switch (discrepancy.kind) {
    case "value_mismatch_invoice_vs_packing_list": {
      // Correct the portal's invoice value to match the packing list
      const invoiceVal = caseFile.documents.invoice?.value ?? "unknown";
      const packingVal = caseFile.documents.packing_list?.value ?? "unknown";
      return {
        field: "invoiceValue",
        from: invoiceVal,
        to: packingVal, // harmonize to packing list value
      };
    }
    case "missing_hs_code": {
      return {
        field: "hsCode",
        from: "",
        to: caseFile.shipment.hsCode ?? "0000.00.00",
      };
    }
    default:
      return { field: "unknown", from: "", to: "" };
  }
}

/**
 * The Computer Use amendment loop.
 * Steps through the portal correction, emitting computer_use_step events,
 * then HALTS before Submit and emits needs_confirmation.
 *
 * In demo mode: simulated with delays.
 * In live mode: would use Playwright + Gemini 2.5 screenshot→action loop.
 */
async function amendEntry(pending: PendingCorrection): Promise<void> {
  const { caseId, field, from, to } = pending;

  // Define the simulated step sequence
  const steps: CorrectionStep[] = [
    {
      action: "navigate",
      target: "http://localhost:5174",
      description: "Opening EU Customs Portal — Single Window",
    },
    {
      action: "click",
      target: `#${field}`,
      description: `Locating field: ${fieldLabel(field)}`,
    },
    {
      action: "clear",
      target: `#${field}`,
      description: `Clearing current value: "${from}"`,
    },
    {
      action: "type",
      target: `#${field}`,
      value: to,
      description: `Typing corrected value: "${to}"`,
    },
    {
      action: "scroll",
      target: "#submitBtn",
      description: "Scrolling to Submit Declaration button",
    },
    {
      action: "halt",
      target: "#submitBtn",
      description: "⏸ HALTING before Submit — awaiting human confirmation",
    },
  ];

  // Execute each step with delay (demo mode simulation)
  for (const step of steps) {
    await new Promise((resolve) => setTimeout(resolve, 800));

    pending.steps.push(step);

    if (step.action === "halt") {
      // HALT — do NOT click submit
      pending.status = "awaiting_confirmation";

      broadcast("needs_confirmation", {
        caseId,
        discrepancyId: pending.discrepancyId,
        correction: {
          field: pending.field,
          fieldLabel: fieldLabel(pending.field),
          from: pending.from,
          to: pending.to,
        },
        discrepancy: pending.discrepancy,
        message: "Computer Use agent has amended the field and is ready to submit. Awaiting your approval.",
      });

      return; // ← THE GATE: we return here, Submit is never reached
    }

    // Emit step event for office animation
    broadcast("computer_use_step", {
      caseId,
      step,
      stepIndex: pending.steps.length,
      totalSteps: steps.length,
    });
  }
}

/**
 * CONFIRM SUBMIT — only callable after human approval.
 * This is the ONLY code path that submits the declaration.
 */
export async function confirmSubmit(
  caseId: string
): Promise<{ success: boolean; correction: { field: string; from: string; to: string } }> {
  const pending = pendingCorrections.get(caseId);
  if (!pending) throw new Error("No pending correction for this case");
  if (pending.status !== "awaiting_confirmation") {
    throw new Error(`Cannot confirm: status is ${pending.status}`);
  }

  pending.status = "confirmed";

  // Emit the submit step
  broadcast("computer_use_step", {
    caseId,
    step: {
      action: "submit",
      target: "#submitBtn",
      description: "✓ Human approved — clicking Submit Declaration",
    },
    stepIndex: pending.steps.length + 1,
    totalSteps: pending.steps.length + 1,
  });

  // Emit correction submitted event
  broadcast("correction_submitted", {
    caseId,
    discrepancyId: pending.discrepancyId,
    correction: {
      field: pending.field,
      from: pending.from,
      to: pending.to,
    },
  });

  const result = {
    success: true,
    correction: {
      field: pending.field,
      from: pending.from,
      to: pending.to,
    },
  };

  // Clean up
  pendingCorrections.delete(caseId);

  return result;
}

/**
 * REJECT SUBMIT — human rejected the correction.
 * Nothing is sent. Discrepancy stays open.
 */
export async function rejectSubmit(caseId: string): Promise<void> {
  const pending = pendingCorrections.get(caseId);
  if (!pending) throw new Error("No pending correction for this case");
  if (pending.status !== "awaiting_confirmation") {
    throw new Error(`Cannot reject: status is ${pending.status}`);
  }

  pending.status = "rejected";

  broadcast("correction_rejected", {
    caseId,
    discrepancyId: pending.discrepancyId,
    message: "Human rejected the correction. Nothing was submitted.",
  });

  // Clean up — nothing was sent
  pendingCorrections.delete(caseId);
}

/**
 * Get the pending correction for a case (if any).
 */
export function getPendingCorrection(caseId: string): PendingCorrection | undefined {
  return pendingCorrections.get(caseId);
}

/** Human-readable field labels */
function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    invoiceValue: "Invoice Value",
    packingListValue: "Packing List Value",
    hsCode: "HS Code",
    valueProof: "Value Proof Document",
  };
  return labels[field] ?? field;
}
