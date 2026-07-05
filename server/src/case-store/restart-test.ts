// server/src/case-store/restart-test.ts
// =====================================================================
// COLD-RESTART INTEGRATION TEST — Statement-Four proof
// =====================================================================
// This test:
// 1. Creates a LocalCaseStore and seeds a full case with documents,
//    discrepancies, corrections, and openQueries
// 2. Closes the DB (simulating process death)
// 3. Opens a BRAND NEW LocalCaseStore on the same DB file (cold restart)
// 4. Calls resume(environmentId)
// 5. Asserts the entire CaseFile is structurally identical
//    (documents, discrepancies, corrections, openQueries all survive)
// 6. Verifies day incremented and lastTouchedAt refreshed
//
// This test uses real DB file I/O with full close/reopen — not in-process
// simulation. It is the definition of done for Phase 2.
// =====================================================================

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { LocalCaseStore } from "./local.js";
import { unlinkSync, existsSync } from "node:fs";
import type { CaseFile, Discrepancy, CustomsQuery, Correction } from "@clearborder/core";

const TEST_DB = "test-restart.db";

// Helper: clean up WAL files too
function cleanupDb() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = TEST_DB + suffix;
    if (existsSync(f)) unlinkSync(f);
  }
}

describe("Cold-Restart Persistence Test (Phase 2 — Statement Four proof)", () => {
  let environmentId: string;
  let caseId: string;
  let snapshotBeforeKill: CaseFile;

  before(async () => {
    cleanupDb();

    // === PHASE 1: Create and populate case, then "kill" (close DB) ===
    const store1 = new LocalCaseStore(TEST_DB);

    // Create case
    const created = await store1.create({
      shipment: {
        ref: "SHIP-RESTART-001",
        origin: "Shenzhen, China",
        destination: "Hamburg, Germany",
        hsCode: "8541.40.90",
      },
    });
    caseId = created.caseId;
    environmentId = created.environmentId;

    // Append documents
    await store1.append(caseId, {
      documents: {
        invoice: { value: "€47,250.00", source: "call" },
        packing_list: { value: "€45,000.00", source: "upload" },
        hs_code: { value: "8541.40.90", source: "call" },
      },
    });

    // Detect discrepancies (value mismatch)
    const discrepancies = await store1.detectDiscrepancies(caseId);
    assert.ok(discrepancies.length > 0, "Should detect at least one discrepancy");
    assert.ok(
      discrepancies.some((d) => d.kind === "value_mismatch_invoice_vs_packing_list"),
      "Should detect value mismatch"
    );

    // Append corrections
    await store1.append(caseId, {
      corrections: [
        {
          at: new Date().toISOString(),
          field: "invoice_value",
          from: "€47,250.00",
          to: "€45,000.00",
          by: "agent",
        },
      ],
    });

    // Append openQueries
    await store1.append(caseId, {
      openQueries: [
        {
          id: "query-001",
          question: "Please provide proof that the declared value includes CIF freight charges.",
          status: "pending",
        },
        {
          id: "query-002",
          question: "Confirm the HS code classification for monocrystalline silicon panels.",
          answer: "Confirmed: 8541.40.90 per EU Combined Nomenclature",
          status: "answered",
        },
      ],
    });

    // Take snapshot before "kill"
    snapshotBeforeKill = (await store1.get(caseId))!;
    assert.ok(snapshotBeforeKill, "Case should exist before kill");

    // Verify the snapshot is populated
    assert.equal(Object.keys(snapshotBeforeKill.documents).length, 3, "Should have 3 documents");
    assert.ok(snapshotBeforeKill.discrepancies.length > 0, "Should have discrepancies");
    assert.equal(snapshotBeforeKill.corrections.length, 1, "Should have 1 correction");
    assert.equal(snapshotBeforeKill.openQueries.length, 2, "Should have 2 open queries");
    assert.equal(snapshotBeforeKill.day, 1, "Day should be 1 before restart");

    // === KILL: Close DB — simulates process termination ===
    store1.close();
  });

  after(() => {
    cleanupDb();
  });

  it("resume(environmentId) after cold restart returns the full CaseFile with all state intact", async () => {
    // === PHASE 2: Cold restart — new store instance on same DB file ===
    const store2 = new LocalCaseStore(TEST_DB);

    // Resume by environmentId
    const resumed = await store2.resume(environmentId);
    assert.ok(resumed, "resume() should return a CaseFile");

    // === ASSERTIONS: Deep equality of persisted state ===

    // Core identity
    assert.equal(resumed.caseId, snapshotBeforeKill.caseId, "caseId must match");
    assert.equal(resumed.environmentId, snapshotBeforeKill.environmentId, "environmentId must match");

    // Shipment
    assert.deepEqual(resumed.shipment, snapshotBeforeKill.shipment, "Shipment must be identical");

    // Documents — must be byte-identical
    assert.deepEqual(
      resumed.documents,
      snapshotBeforeKill.documents,
      "All documents must survive restart"
    );

    // Verify each document individually
    assert.equal(resumed.documents.invoice?.value, "€47,250.00");
    assert.equal(resumed.documents.invoice?.source, "call");
    assert.equal(resumed.documents.packing_list?.value, "€45,000.00");
    assert.equal(resumed.documents.packing_list?.source, "upload");
    assert.equal(resumed.documents.hs_code?.value, "8541.40.90");

    // Discrepancies — must persist with exact detail text and status
    assert.equal(
      resumed.discrepancies.length,
      snapshotBeforeKill.discrepancies.length,
      "Discrepancy count must match"
    );
    for (let i = 0; i < resumed.discrepancies.length; i++) {
      assert.equal(resumed.discrepancies[i].id, snapshotBeforeKill.discrepancies[i].id);
      assert.equal(resumed.discrepancies[i].kind, snapshotBeforeKill.discrepancies[i].kind);
      assert.equal(resumed.discrepancies[i].detail, snapshotBeforeKill.discrepancies[i].detail);
      assert.equal(resumed.discrepancies[i].status, snapshotBeforeKill.discrepancies[i].status);
      assert.equal(resumed.discrepancies[i].openedAt, snapshotBeforeKill.discrepancies[i].openedAt);
    }

    // Corrections — must persist exactly
    assert.deepEqual(
      resumed.corrections,
      snapshotBeforeKill.corrections,
      "All corrections must survive restart"
    );
    assert.equal(resumed.corrections[0].field, "invoice_value");
    assert.equal(resumed.corrections[0].from, "€47,250.00");
    assert.equal(resumed.corrections[0].to, "€45,000.00");
    assert.equal(resumed.corrections[0].by, "agent");

    // Open queries — must persist exactly
    assert.deepEqual(
      resumed.openQueries,
      snapshotBeforeKill.openQueries,
      "All open queries must survive restart"
    );
    assert.equal(resumed.openQueries[0].status, "pending");
    assert.equal(resumed.openQueries[1].status, "answered");
    assert.equal(resumed.openQueries[1].answer, "Confirmed: 8541.40.90 per EU Combined Nomenclature");

    // Day must increment on resume
    assert.equal(resumed.day, snapshotBeforeKill.day + 1, "Day must increment on resume");
    assert.equal(resumed.day, 2, "Day should be 2 after first resume");

    // TTL (lastTouchedAt) must refresh
    assert.notEqual(
      resumed.lastTouchedAt,
      snapshotBeforeKill.lastTouchedAt,
      "lastTouchedAt must be refreshed on resume"
    );
    const resumeTime = new Date(resumed.lastTouchedAt).getTime();
    const killTime = new Date(snapshotBeforeKill.lastTouchedAt).getTime();
    assert.ok(resumeTime >= killTime, "Resume time must be >= kill time");

    // Clean up
    store2.close();
  });

  it("second resume increments day again (day 2 → 3)", async () => {
    const store3 = new LocalCaseStore(TEST_DB);
    const resumed2 = await store3.resume(environmentId);
    assert.ok(resumed2);
    assert.equal(resumed2.day, 3, "Second resume should set day to 3");

    // All data still intact
    assert.deepEqual(resumed2.documents, snapshotBeforeKill.documents);
    assert.equal(resumed2.discrepancies.length, snapshotBeforeKill.discrepancies.length);
    assert.deepEqual(resumed2.corrections, snapshotBeforeKill.corrections);
    assert.deepEqual(resumed2.openQueries, snapshotBeforeKill.openQueries);

    store3.close();
  });

  it("detectDiscrepancies is idempotent after restart", async () => {
    const store4 = new LocalCaseStore(TEST_DB);

    // Run detectDiscrepancies again — should NOT add duplicates
    const newDisc = await store4.detectDiscrepancies(caseId);
    assert.equal(newDisc.length, 0, "Should not create duplicate discrepancies");

    // Verify total count hasn't grown
    const cf = await store4.get(caseId);
    assert.ok(cf);
    const valueMismatchCount = cf.discrepancies.filter(
      (d) => d.kind === "value_mismatch_invoice_vs_packing_list"
    ).length;
    assert.equal(valueMismatchCount, 1, "Should still have exactly one value_mismatch discrepancy");

    store4.close();
  });
});
