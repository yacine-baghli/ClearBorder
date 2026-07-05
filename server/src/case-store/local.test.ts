// server/src/case-store/local.test.ts
// Unit tests for LocalCaseStore — create, get, resume, append, detectDiscrepancies

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { LocalCaseStore } from "./local.js";
import { unlinkSync, existsSync } from "node:fs";

const TEST_DB = "test-casestore.db";

describe("LocalCaseStore", () => {
  let store: LocalCaseStore;

  before(() => {
    // Clean up any leftover test DB
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    store = new LocalCaseStore(TEST_DB);
  });

  after(() => {
    store.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it("create() returns a full CaseFile with defaults", async () => {
    const cf = await store.create({
      shipment: { ref: "SHIP-001", origin: "France", destination: "Germany" },
    });

    assert.ok(cf.caseId, "caseId should be generated");
    assert.ok(cf.environmentId, "environmentId should be generated");
    assert.equal(cf.shipment.ref, "SHIP-001");
    assert.equal(cf.shipment.origin, "France");
    assert.equal(cf.day, 1);
    assert.deepEqual(cf.documents, {});
    assert.deepEqual(cf.discrepancies, []);
    assert.deepEqual(cf.corrections, []);
  });

  it("get() retrieves a previously created case", async () => {
    const created = await store.create({
      shipment: { ref: "SHIP-002", origin: "China", destination: "France" },
    });

    const retrieved = await store.get(created.caseId);
    assert.ok(retrieved);
    assert.deepEqual(retrieved.shipment, created.shipment);
    assert.equal(retrieved.caseId, created.caseId);
    assert.equal(retrieved.environmentId, created.environmentId);
  });

  it("get() returns null for non-existent case", async () => {
    const result = await store.get("non-existent-id");
    assert.equal(result, null);
  });

  it("append() merges documents and arrays into the case", async () => {
    const cf = await store.create({
      shipment: { ref: "SHIP-003", origin: "Japan", destination: "USA" },
    });

    const updated = await store.append(cf.caseId, {
      documents: {
        invoice: { value: "€12,000", source: "call" },
      },
    });

    assert.equal(updated.documents.invoice?.value, "€12,000");
    assert.equal(updated.documents.invoice?.source, "call");

    // Append more docs — should merge, not overwrite
    const updated2 = await store.append(cf.caseId, {
      documents: {
        packing_list: { value: "€15,000", source: "upload" },
      },
    });

    assert.equal(updated2.documents.invoice?.value, "€12,000");
    assert.equal(updated2.documents.packing_list?.value, "€15,000");
  });

  it("append() throws for non-existent case", async () => {
    await assert.rejects(
      () => store.append("nonexistent", { day: 5 }),
      { message: "Case nonexistent not found" }
    );
  });

  it("resume() retrieves case by environmentId and increments day", async () => {
    const cf = await store.create({
      shipment: { ref: "SHIP-004", origin: "India", destination: "UK" },
    });

    assert.equal(cf.day, 1);

    const resumed = await store.resume(cf.environmentId);
    assert.ok(resumed);
    assert.equal(resumed.caseId, cf.caseId);
    assert.equal(resumed.day, 2);
    assert.equal(resumed.shipment.ref, "SHIP-004");

    // Resume again — day should be 3
    const resumed2 = await store.resume(cf.environmentId);
    assert.ok(resumed2);
    assert.equal(resumed2.day, 3);
  });

  it("resume() returns null for unknown environmentId", async () => {
    const result = await store.resume("unknown-env-id");
    assert.equal(result, null);
  });

  it("detectDiscrepancies() flags value mismatch between invoice and packing list", async () => {
    const cf = await store.create({
      shipment: { ref: "SHIP-005", origin: "Brazil", destination: "Portugal", hsCode: "8471.30" },
    });

    await store.append(cf.caseId, {
      documents: {
        invoice: { value: "€12,000", source: "call" },
        packing_list: { value: "€15,000", source: "upload" },
      },
    });

    const discrepancies = await store.detectDiscrepancies(cf.caseId);
    assert.equal(discrepancies.length, 1);
    assert.equal(discrepancies[0].kind, "value_mismatch_invoice_vs_packing_list");
    assert.equal(discrepancies[0].status, "open");
    assert.ok(discrepancies[0].detail.includes("12,000"));
    assert.ok(discrepancies[0].detail.includes("15,000"));
  });

  it("detectDiscrepancies() flags missing HS code", async () => {
    const cf = await store.create({
      shipment: { ref: "SHIP-006", origin: "Mexico", destination: "Canada" },
      // no hsCode
    });

    const discrepancies = await store.detectDiscrepancies(cf.caseId);
    assert.ok(discrepancies.some((d) => d.kind === "missing_hs_code"));
  });

  it("detectDiscrepancies() does not duplicate existing discrepancies", async () => {
    const cf = await store.create({
      shipment: { ref: "SHIP-007", origin: "Korea", destination: "Japan" },
    });

    // First detect
    await store.detectDiscrepancies(cf.caseId);

    // Second detect — should not add duplicates
    const second = await store.detectDiscrepancies(cf.caseId);
    assert.equal(second.length, 0, "Should not create duplicate discrepancies");

    // Verify total discrepancies in the case
    const full = await store.get(cf.caseId);
    assert.ok(full);
    const missingHs = full.discrepancies.filter(
      (d) => d.kind === "missing_hs_code"
    );
    assert.equal(missingHs.length, 1, "Only one missing_hs_code discrepancy");
  });
});
