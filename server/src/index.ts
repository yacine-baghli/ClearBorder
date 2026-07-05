// server/src/index.ts
// ClearBorder API server — Fastify + WebSocket event bus
// All secrets stay here. Console/portal get ephemeral tokens only.

import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { LocalCaseStore } from "./case-store/local.js";
import { addClient, broadcast } from "./events.js";
import {
  openTranslateSession,
  simulateDemoCall,
  getTranscripts,
  getSessionInfo,
  closeSession,
  mintEphemeralToken,
} from "./live-translate.js";
import {
  startCorrection,
  confirmSubmit,
  rejectSubmit,
  getPendingCorrection,
} from "./computer-use.js";
import { OrderStore } from "./orderStore.js";
import {
  initMemorySession,
  startSessionLoop,
  stopSessionLoop,
  registerSession,
  checkCase,
  getSessionStatus,
  markSessionIdle,
  listSessions,
} from "./memorySession.js";
import type { CaseFile, DocKind, OrderSnapshot } from "@clearborder/core";

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const CASE_STORE = process.env.CASE_STORE ?? "local";

// --- CaseStore factory ---
function createCaseStore() {
  if (CASE_STORE === "local") {
    return new LocalCaseStore("clearborder.db");
  }
  // Future: InteractionsCaseStore
  throw new Error(`Unknown CASE_STORE: ${CASE_STORE}. Use "local".`);
}

const caseStore = createCaseStore();
const orderStore = new OrderStore("clearborder.db");

// Seed a default order for the demo
orderStore.seed("SHIP-RESTART-001");

// Initialize memory session worker
initMemorySession({
  caseStore,
  orderStore,
  startCorrection,
  intervalMs: parseInt(process.env.SESSION_INTERVAL_MS ?? "20000", 10),
});

// --- Fastify setup ---
const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(websocket);

// --- WebSocket ---
app.register(async function wsRoutes(fastify) {
  fastify.get("/ws", { websocket: true }, (socket, _req) => {
    addClient(socket);
  });
});

// ========================================
// REST routes — Cases
// ========================================

// Health check
app.get("/health", async () => ({
  status: "ok",
  store: CASE_STORE,
  demoMode: process.env.DEMO_MODE === "true",
}));

// Create a new case
app.post<{ Body: Partial<CaseFile> }>("/api/cases", async (req, reply) => {
  const caseFile = await caseStore.create(req.body);
  broadcast("case_created", { caseId: caseFile.caseId });
  return reply.code(201).send(caseFile);
});

// Get a case by ID
app.get<{ Params: { caseId: string } }>("/api/cases/:caseId", async (req, reply) => {
  const cf = await caseStore.get(req.params.caseId);
  if (!cf) return reply.code(404).send({ error: "Case not found" });
  return cf;
});

// Resume a case by environmentId
app.post<{ Body: { environmentId: string } }>("/api/cases/resume", async (req, reply) => {
  const cf = await caseStore.resume(req.body.environmentId);
  if (!cf) return reply.code(404).send({ error: "No case found for that environmentId" });
  broadcast("resumed", { caseId: cf.caseId, day: cf.day });
  return cf;
});

// Append data to a case
app.patch<{ Params: { caseId: string }; Body: Partial<CaseFile> }>(
  "/api/cases/:caseId",
  async (req, reply) => {
    try {
      const cf = await caseStore.append(req.params.caseId, req.body);
      broadcast("case_updated", { caseId: cf.caseId });
      return cf;
    } catch (e: any) {
      return reply.code(404).send({ error: e.message });
    }
  }
);

// Detect discrepancies for a case
app.post<{ Params: { caseId: string } }>(
  "/api/cases/:caseId/discrepancies",
  async (req, reply) => {
    try {
      const discrepancies = await caseStore.detectDiscrepancies(req.params.caseId);
      if (discrepancies.length > 0) {
        broadcast("discrepancy_detected", {
          caseId: req.params.caseId,
          discrepancies,
        });
      }
      return { discrepancies };
    } catch (e: any) {
      return reply.code(404).send({ error: e.message });
    }
  }
);

// ========================================
// REST routes — Live Translate
// ========================================

// Start a Live Translate session
app.post<{ Body: { caseId: string; targetLanguageCode: string } }>(
  "/api/translate/start",
  async (req, reply) => {
    const { caseId, targetLanguageCode } = req.body;

    // Verify the case exists
    const cf = await caseStore.get(caseId);
    if (!cf) return reply.code(404).send({ error: "Case not found" });

    const result = await openTranslateSession({ targetLanguageCode, caseId });
    return result;
  }
);

// Run the demo simulation (push pre-scripted transcripts)
app.post<{ Body: { caseId: string } }>(
  "/api/translate/demo",
  async (req, reply) => {
    const { caseId } = req.body;
    // Run the demo call asynchronously — transcripts stream via WS
    simulateDemoCall(caseId).catch((err) =>
      console.error("Demo simulation error:", err)
    );
    return { status: "started", caseId };
  }
);

// Get current transcripts
app.get("/api/translate/transcripts", async () => {
  return { transcripts: getTranscripts() };
});

// Get session info
app.get("/api/translate/session", async () => {
  return { session: getSessionInfo() };
});

// Close the current translate session
app.post("/api/translate/close", async () => {
  closeSession();
  return { status: "closed" };
});

// Mint an ephemeral token for the console
app.post<{ Body: { targetLanguageCode: string } }>(
  "/api/translate/token",
  async (req) => {
    const token = await mintEphemeralToken(req.body.targetLanguageCode);
    return token;
  }
);

// ========================================
// REST routes — Capture as Fact
// ========================================

// "Capture as fact" — operator captures a transcript value into the CaseFile
app.post<{
  Params: { caseId: string };
  Body: { docKind: DocKind; value: string };
}>("/api/cases/:caseId/capture", async (req, reply) => {
  const { caseId } = req.params;
  const { docKind, value } = req.body;

  try {
    const cf = await caseStore.append(caseId, {
      documents: {
        [docKind]: { value, source: "call" as const },
      },
    });

    broadcast("fact_captured", {
      caseId,
      docKind,
      value,
      source: "call",
    });

    return cf;
  } catch (e: any) {
    return reply.code(404).send({ error: e.message });
  }
});

// ========================================
// REST routes — Computer Use (Phase 3)
// ========================================

// Start Computer Use correction for an open discrepancy
app.post<{
  Params: { caseId: string };
  Body: { discrepancyId: string };
}>("/api/cases/:caseId/correct", async (req, reply) => {
  const { caseId } = req.params;
  const { discrepancyId } = req.body;

  const cf = await caseStore.get(caseId);
  if (!cf) return reply.code(404).send({ error: "Case not found" });

  try {
    // startCorrection runs the amendment loop (halts before submit)
    const pending = await startCorrection(cf, discrepancyId);
    return { status: pending.status, correction: { field: pending.field, from: pending.from, to: pending.to } };
  } catch (e: any) {
    return reply.code(400).send({ error: e.message });
  }
});

// Human APPROVES the correction — this is the ONLY path to submit
app.post<{ Params: { caseId: string } }>(
  "/api/cases/:caseId/confirm",
  async (req, reply) => {
    const { caseId } = req.params;

    try {
      const result = await confirmSubmit(caseId);

      // Record the correction in the CaseFile with by:"human"
      const cf = await caseStore.append(caseId, {
        corrections: [
          {
            at: new Date().toISOString(),
            field: result.correction.field,
            from: result.correction.from,
            to: result.correction.to,
            by: "human",
          },
        ],
      });

      // Flip the discrepancy status to "submitted"
      const updatedDiscrepancies = cf.discrepancies.map((d) => {
        // Find the matching discrepancy by kind (since corrections map to discrepancy kinds)
        if (d.status === "open") {
          return { ...d, status: "submitted" as const, resolvedAt: new Date().toISOString() };
        }
        return d;
      });

      // Persist the updated discrepancy statuses
      await caseStore.append(caseId, {
        discrepancies: [], // append merges, so we need to update via a direct mechanism
      });

      // Update the case with the resolved discrepancies
      // We need to overwrite discrepancies — use a special update
      const finalCase = await caseStore.get(caseId);
      if (finalCase) {
        finalCase.discrepancies = updatedDiscrepancies;
        // Save the updated case by re-appending (the append function updates the whole blob)
        await caseStore.append(caseId, {});
        // Directly update the stored JSON with corrected discrepancies
        await caseStore.updateDiscrepancyStatus(caseId, updatedDiscrepancies);
      }

      broadcast("correction_submitted", { caseId, correction: result.correction });
      broadcast("case_updated", { caseId });
      markSessionIdle(caseId);

      return { status: "submitted", correction: result.correction };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }
);

// Human REJECTS the correction — nothing is sent
app.post<{ Params: { caseId: string } }>(
  "/api/cases/:caseId/reject",
  async (req, reply) => {
    const { caseId } = req.params;

    try {
      await rejectSubmit(caseId);
      broadcast("correction_rejected", { caseId });
      markSessionIdle(caseId);
      return { status: "rejected" };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }
);

// ========================================
// REST routes — Day Close / Resume (Phase 4)
// ========================================

// Close the current day session — triggers sleep animation in office
app.post<{ Body: { caseId: string } }>(
  "/api/day/close",
  async (req) => {
    const { caseId } = req.body;
    broadcast("day_closed", { caseId, message: "Session closed — all agents sleeping" });
    return { status: "closed" };
  }
);

// ========================================
// REST routes — Orders (Live Product Mode)
// ========================================

// Get order by ref
app.get<{ Params: { ref: string } }>("/api/orders/:ref", async (req) => {
  const order = orderStore.get(req.params.ref);
  if (!order) return { error: "Order not found" };
  return order;
});

// List all orders
app.get("/api/orders", async () => {
  return orderStore.list();
});

// Update order fields — bumps version, emits order_changed event
app.put<{ Params: { ref: string }; Body: { fields: OrderSnapshot["fields"] } }>(
  "/api/orders/:ref",
  async (req) => {
    const { ref } = req.params;
    const { fields } = req.body;
    const updated = orderStore.upsert(ref, fields);
    broadcast("order_changed", { ref: updated.ref, version: updated.version, fields: updated.fields });

    // Instant trigger: find linked case and check immediately (debounced)
    const cases = await Promise.all(
      listSessions().map(s => caseStore.get(s.caseId))
    );
    for (const c of cases) {
      if (c && c.shipment.ref === ref) {
        setTimeout(() => checkCase(c.caseId), 500); // debounce 500ms
      }
    }

    return updated;
  }
);

// ========================================
// REST routes — Session (Memory Session Worker)
// ========================================

// Get session status
app.get<{ Params: { caseId: string } }>("/api/session/:caseId/status", async (req) => {
  const status = getSessionStatus(req.params.caseId);
  if (!status) return { error: "No active session for this case" };
  return status;
});

// Force an immediate check
app.post<{ Params: { caseId: string } }>("/api/session/:caseId/check-now", async (req) => {
  await checkCase(req.params.caseId);
  return { status: "checked" };
});

// List all sessions
app.get("/api/sessions", async () => {
  return listSessions();
});

// Register a case for monitoring (creates session)
app.post<{ Body: { caseId: string; environmentId: string; orderRef: string } }>(
  "/api/session/register",
  async (req) => {
    const { caseId, environmentId, orderRef } = req.body;
    const session = registerSession(caseId, environmentId, orderRef);
    return session;
  }
);

// ========================================
// Reset (for demo)
// ========================================

app.post("/api/reset", async () => {
  orderStore.reset();
  orderStore.seed("SHIP-RESTART-001");
  stopSessionLoop();
  startSessionLoop();
  broadcast("reset", { message: "All state cleared" });
  return { status: "reset" };
});

// ========================================
// Start
// ========================================

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`🚀 ClearBorder server running on http://localhost:${PORT}`);
  console.log(`   CaseStore: ${CASE_STORE}`);
  console.log(`   Demo mode: ${process.env.DEMO_MODE ?? "false"}`);

  // Start the memory session loop
  startSessionLoop();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
