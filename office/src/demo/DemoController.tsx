import { useCallback, useEffect, useRef } from "react";
import DEMO_SCRIPT from "./demo-script";
import { Beat, DemoState, PipelineBeat } from "./types";

// =====================================================
// DemoController — Story Engine (scene-based)
// =====================================================
// Sequences beats from demo-script.ts.
// Pipeline beats POST to REAL server endpoints.
// waitForApproval uses the REAL Phase 3 human-confirm gate.

const API = "http://localhost:3001";

export interface DemoAPI {
  play: () => void;
  pause: () => void;
  next: () => void;
  reset: () => void;
  onApproved: () => void;
  onRejected: () => void;
  getCurrentBeat: () => Beat | null;
  getCurrentIndex: () => number;
  getState: () => DemoState;
  getBeatCount: () => number;
  getCaseId: () => string | null;
}

interface Props {
  onBeatChange: (beat: Beat, index: number) => void;
  onStateChange: (state: DemoState) => void;
  controllerRef: React.MutableRefObject<DemoAPI | null>;
}

export default function DemoController({ onBeatChange, onStateChange, controllerRef }: Props) {
  const stateRef = useRef<DemoState>("idle");
  const indexRef = useRef(-1);
  const caseIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setState = useCallback((s: DemoState) => {
    stateRef.current = s;
    onStateChange(s);
  }, [onStateChange]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  // ── Pipeline dispatch — calls REAL server endpoints ──
  const runPipeline = useCallback(async (beat: PipelineBeat) => {
    const caseId = caseIdRef.current;

    switch (beat.payload.action) {
      case "translate": {
        // Step 1: Create a case if we don't have one
        if (!caseId) {
          const res = await fetch(`${API}/api/cases`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          const cf = await res.json();
          caseIdRef.current = cf.caseId;
        }
        const id = caseIdRef.current!;

        // Step 2: Capture the seeded trade facts (real endpoint)
        const facts = [
          { docKind: "invoice", value: "€47,250.00" },
          { docKind: "packing_list", value: "€45,000.00" },
          { docKind: "hs_code", value: "8541.40.90" },
        ];
        for (const f of facts) {
          await fetch(`${API}/api/cases/${id}/capture`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(f),
          });
          // Small delay so WS events stagger and agents animate individually
          await new Promise(r => setTimeout(r, 800));
        }
        break;
      }

      case "detect": {
        if (!caseIdRef.current) break;
        // Real discrepancy detection
        await fetch(`${API}/api/cases/${caseIdRef.current}/discrepancies`, {
          method: "POST",
        });
        break;
      }

      case "computerUse": {
        if (!caseIdRef.current) break;
        // Real Computer Use correction — triggers needs_confirmation WS event
        try {
          await fetch(`${API}/api/cases/${caseIdRef.current}/correct`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ discrepancyId: "0" }),
          });
        } catch (e) {
          console.log("[Demo] Computer Use endpoint returned error (expected in demo mode):", e);
        }
        break;
      }
    }
  }, []);

  // ── Dispatch a single beat ──
  const dispatch = useCallback(async (beat: Beat, idx: number) => {
    console.log(`[Demo] Beat ${beat.id}/${DEMO_SCRIPT.length} [${beat.type}] Scene ${beat.scene} — "${beat.step}"`);
    onBeatChange(beat, idx);

    // waitForApproval — hard block
    if (beat.type === "waitForApproval") {
      setState("waitingApproval");
      return;
    }

    // Pipeline beats — call real server
    if (beat.type === "pipeline") {
      await runPipeline(beat as PipelineBeat);
    }

    // Auto-advance
    if (beat.autoAdvanceMs && stateRef.current === "playing") {
      timerRef.current = setTimeout(() => {
        if (stateRef.current === "playing") advance(idx);
      }, beat.autoAdvanceMs);
    }
  }, [onBeatChange, setState, runPipeline]);

  // ── Advance ──
  const advance = useCallback((fromIdx: number) => {
    clearTimer();
    const next = fromIdx + 1;
    if (next >= DEMO_SCRIPT.length) {
      indexRef.current = DEMO_SCRIPT.length - 1;
      setState("complete");
      // Fire final beat change so UI updates
      onBeatChange(DEMO_SCRIPT[DEMO_SCRIPT.length - 1], DEMO_SCRIPT.length - 1);
      return;
    }
    indexRef.current = next;
    dispatch(DEMO_SCRIPT[next], next);
  }, [clearTimer, setState, dispatch, onBeatChange]);

  // ── Public API ──
  const play = useCallback(() => {
    if (stateRef.current === "waitingApproval") return;
    if (stateRef.current === "idle" || indexRef.current === -1) {
      setState("playing");
      indexRef.current = 0;
      dispatch(DEMO_SCRIPT[0], 0);
    } else if (stateRef.current === "paused") {
      setState("playing");
      const beat = DEMO_SCRIPT[indexRef.current];
      if (beat?.autoAdvanceMs) {
        timerRef.current = setTimeout(() => {
          if (stateRef.current === "playing") advance(indexRef.current);
        }, beat.autoAdvanceMs);
      }
    }
  }, [setState, dispatch, advance]);

  const pause = useCallback(() => {
    if (stateRef.current === "playing") { clearTimer(); setState("paused"); }
  }, [clearTimer, setState]);

  const next = useCallback(() => {
    if (stateRef.current === "waitingApproval" || stateRef.current === "complete") return;
    if (indexRef.current === -1) {
      setState("playing");
      indexRef.current = 0;
      dispatch(DEMO_SCRIPT[0], 0);
      return;
    }
    clearTimer();
    // If current beat is a pipeline beat still running, just advance anyway
    advance(indexRef.current);
  }, [clearTimer, advance, setState, dispatch]);

  const reset = useCallback(() => {
    clearTimer();
    indexRef.current = -1;
    caseIdRef.current = null;
    setState("idle");
  }, [clearTimer, setState]);

  const onApproved = useCallback(async () => {
    if (stateRef.current !== "waitingApproval") return;
    // Real Phase 3 gate — POST /confirm
    if (caseIdRef.current) {
      await fetch(`${API}/api/cases/${caseIdRef.current}/confirm`, { method: "POST" });
    }
    setState("playing");
    advance(indexRef.current);
  }, [setState, advance]);

  const onRejected = useCallback(async () => {
    if (stateRef.current !== "waitingApproval") return;
    // Real Phase 3 gate — POST /reject (no-op, nothing sent)
    if (caseIdRef.current) {
      await fetch(`${API}/api/cases/${caseIdRef.current}/reject`, { method: "POST" });
    }
    // Stay on current beat — don't advance
    console.log("[Demo] Rejected — nothing submitted");
  }, []);

  // Expose API
  useEffect(() => {
    controllerRef.current = {
      play, pause, next, reset, onApproved, onRejected,
      getCurrentBeat: () => indexRef.current >= 0 ? DEMO_SCRIPT[indexRef.current] : null,
      getCurrentIndex: () => indexRef.current,
      getState: () => stateRef.current,
      getBeatCount: () => DEMO_SCRIPT.length,
      getCaseId: () => caseIdRef.current,
    };
  }, [play, pause, next, reset, onApproved, onRejected, controllerRef]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return null; // Logic-only component
}
