# ClearBorder — Demo Mode Implementation Plan (Google Antigravity)

> **Purpose:** Turn the working pipeline into a guided, deterministic story that runs when the site opens — the artifact judges actually watch.
> **Weighting:** This is the *Demo* surface (50 % of the score). Treat presentation quality as a first-class deliverable, not decoration.
> **Depends on:** Phases 0–3 (all complete) — CaseStore, WS event bus, Live Translate demo mode, discrepancy detection, Computer Use + human confirm gate, pixel-agents office.
> **Rule:** This is a *presentation layer*. Reuse the existing pipeline; do not rebuild it.

---

## 0. Core design — the story engine is a conductor, not a fake

The demo must stay credible ("this really works") **and** controllable on stage. The way to get both: a **beat sequencer** that interleaves two kinds of steps.

- **Presentation beats** — local UI only: intro popup, timeline advance, Joan's speech bubbles, email animation, container red/green flip.
- **Pipeline triggers** — the conductor calls the *real* server endpoints (`/api/translate/start`, `/capture`, `/discrepancies`, Computer Use run) at the scripted moment. The office agents then animate from **genuine** WS events, exactly as they do today.

So the story is real work, sequenced. Nothing is mocked that wasn't already mocked (the customs portal). The human-approval beat uses the actual Phase 3 gate.

```
DemoController (office/)
  ├─ reads demo-script.ts  (ordered Beat[])
  ├─ for each beat:
  │    ├─ presentation beat → update local UI state
  │    └─ pipeline beat     → POST to server → office reacts to real WS events
  ├─ waitForApproval beat   → blocks until human clicks Approve (real gate)
  └─ controls: Play · Pause · Next (manual step, primary on stage)
```

**Kickoff prompt (paste into Agent Manager):**

> Build "Demo Mode" for ClearBorder per `ClearBorder-demo-mode-plan.md`. It is a presentation layer in `office/` that sequences the EXISTING pipeline (Live Translate demo, discrepancy detection, Computer Use + confirm gate) into a deterministic story told as six scenes. Do not rebuild the pipeline. **Build Scene 4 first (Step 1 in the Build order) — it is the product core** — then pause for my review before the setup scenes. Keep everything offline-safe and seeded; the human-approval beat must use the real Phase 3 gate.

---

## 1. Narrative & coherence (lock this first)

The story must answer "who pays for ClearBorder?" cleanly. Chain: **sympathetic individual → B2B customer → agents.**

- **Joan** — an end customer who ordered a France World Cup shirt online. Emotional hook + timely deadline. *Joan is not ClearBorder's user.*
- **The retailer** — imported a bulk container of France shirts (the existing **€45,000 / €47,250** shipment). Joan's order is one item inside it. **The retailer is ClearBorder's customer.**
- **The hold** — the container is red-lighted at French customs over the invoice-vs-packing-list mismatch + missing HS code. Joan's email is what alerts the retailer, who runs ClearBorder.

This ties the story straight into the seeded numbers already in the build.

---

## 2. The story — six scenes

Present the demo as scene panels: each scene = **a character in a situation**, with a scene title, a visual, and a speech bubble or popup. Scenes 1–3 are fast emotional setup; **Scene 4 is the product and must dominate the runtime.** Build Scene 4 first (see Build order).

- **Scene 0 — Intro.** Full-screen popup: what ClearBorder does, in 2–3 lines. "Start" button closes it. → *beat 1*
- **Scene 1 — "The stuck order."** Joan, worried, at home. Bubble: *"I ordered my France World Cup shirt… it's still not here, and the final is in days!"* → *beats 2–3*
- **Scene 2 — "Joan emails the seller."** Scene title on top. Visual: a **PC** beside Joan; a **popup showing Joan's email** to the retailer (*"Where is my order?"*). → *beat 4*
- **Scene 3 — "The retailer finds the problem."** The **retailer** at their PC. Screen/popup: 🔴 customs alert — the **container of shirts** (the €45,000 / €47,250 shipment) is **held**; Joan's order is one item inside it. Bubble: *"Invoice/packing-list mismatch + missing HS code. I'm launching ClearBorder."* → *beat 5*
- **Scene 4 — "ClearBorder takes over" — THE CORE (build first).** The pixel office. Three agents work: **Translator** calls the Chinese supplier live (Live Translate) and captures *"declared value includes freight"*; **Case-file** detects the mismatch + missing HS code and **remembers everything**; **Portal** drives the customs portal (Computer Use), corrects the fields, then **halts with a "?" bubble** for approval. You click **Approve** → submit. → *beats 6–9*
- **Scene 5 — "Cleared."** Customs flips 🟢 **green**; the container is released. → *beat 10*
- **Scene 6 — "Delivered in time."** Joan, happy, holding the shirt: *"It arrived — just in time!"* Timeline fills to 100 %. → *beat 11*

> Runtime rule: Scenes 1–3 are quick (a few seconds each) — they set up the stakes. Scene 4 is where you slow down and let the agents work; it is the pitch. Make Case-file **visibly remember** on screen — that is the winning argument.

---

## 3. The beat table (this is also your on-stage run-of-show)

Encode this as `office/src/demo/demo-script.ts`. Each beat = `{ id, step, actor, type, payload, autoAdvanceMs?, requiresApproval? }`.

| # | Timeline step | Actor | Type | What happens |
|---|---|---|---|---|
| 1 | — | — | `intro` | Popup: what ClearBorder does. "Start demo" closes it. |
| 2 | Order stuck | Joan | `speech` | "I ordered my France shirt for the World Cup… it still hasn't arrived!" |
| 3 | Order stuck | Joan | `speech` | "The final is in days — I need it now." |
| 4 | Customer alert | Joan | `emailSent` | Joan emails the seller (envelope animation) → hands off to retailer. |
| 5 | Customs hold | Retailer | `containerStatus` | Container of France shirts flips 🔴 **held at French customs**; retailer: "I'm launching ClearBorder." |
| 6 | Live Translate call | Translator | `pipeline: translate` | Real Live Translate demo runs; supplier call streams; captures "declared value includes freight". |
| 7 | Discrepancy found | Case-file | `pipeline: detect` | Real `detectDiscrepancies` → value mismatch (€45,000 vs €47,250) + missing HS code. |
| 8 | Portal fix + approval | Portal | `pipeline: computerUse` | Computer Use opens portal, corrects fields, **halts with "?" bubble**. |
| 9 | Portal fix + approval | Operator | `waitForApproval` | Human clicks **Approve** (real Phase 3 gate). On approve → submit. |
| 10 | Cleared & delivered | — | `containerStatus` | Customs flips 🟢 **green**; container released. |
| 11 | Cleared & delivered | Joan | `speech` | "It arrived — just in time!" Timeline fills to 100 %. |

Keep beats data-driven so pacing and copy are editable without touching engine code.

---

## 4. Build order — Scene 4 first

Build the winning scene before the wrapper. **Scene 4 is the product** and mostly reuses the office + pipeline you already have; Scenes 0–3 and 5–6 are the narrative around it. If time runs short, a polished Scene 4 alone still demos the whole product. Each step = one Agent goal; pause for review after each.

### Step 1 — Scene 4: "ClearBorder takes over" (THE CORE — build first)
- **Goal:** A standalone, playable Scene 4: the minimal scene engine + the office agents driven by the **real** pipeline, ending in the human-approval gate.
- **Scope:** Includes the minimal engine scaffold needed to run one scene — `Beat` types, a `SceneController` with `play/pause/next`, and `demo-script.ts` holding **beats 6–9 first**. Wire those beats to the real endpoints.
- **Files:** `office/src/demo/types.ts`, `office/src/demo/SceneController.tsx`, `office/src/demo/demo-script.ts`, pipeline dispatch, `waitForApproval` on the real gate.
- **Acceptance:** From a "Launch ClearBorder" trigger, Translator → Case-file → Portal animate from **genuine WS events**; Case-file visibly shows it remembers the captured facts; Portal halts with a "?" bubble; human **Approve** submits and flips the discrepancy to `submitted`; **reject = no-op**. Scene 4 runs on its own.
- **Verify:** run Scene 4 standalone; confirm animations come from real events (not hardcoded) and rejection sends nothing.
- **Prompt:** *"Build Scene 4 of ClearBorder Demo Mode as a standalone playable scene in `office/src/demo`. Create the minimal engine (`types.ts` Beat union, `SceneController.tsx` with play/pause/next, `demo-script.ts` with beats 6–9). Wire beats 6–9 to the REAL server endpoints (Live Translate demo, detectDiscrepancies, Computer Use run) so Translator/Case-file/Portal animate from genuine WS events — do not fake agent activity. Case-file must visibly show the remembered facts. Beat 9 (`waitForApproval`) blocks on the real Phase 3 gate: approve submits, reject sends nothing. Verify Scene 4 runs on its own, agents react to real events, and rejection is a no-op. Then pause."*

### Step 2 — Scenes 1–3: the setup (Joan → email → retailer)
- **Goal:** The emotional lead-in that hands off to Scene 4. Joan character + speech bubbles, the email/PC popup, the retailer + red container.
- **Files:** Joan (extend the character component), `office/src/demo/SpeechBubble.tsx`, `office/src/demo/EmailPopup.tsx`, `office/src/demo/Container.tsx`; add beats 2–5 to `demo-script.ts` before Scene 4's beats.
- **Acceptance:** Joan renders in the existing pixel style and speaks (beats 2–3); the email popup shows Joan's message beside a PC (beat 4); the retailer appears and the container flips 🔴 (beat 5); the story then flows straight into Scene 4.
- **Verify:** screenshot each scene; confirm beats 2→5 lead into Scene 4 with no gap.
- **Prompt:** *"Add Scenes 1–3 before Scene 4: a pixel character Joan matching the existing CSS pixel-art style with `SpeechBubble` (beats 2–3), an `EmailPopup` beside a PC for beat 4, and a retailer + `Container` that flips red on beat 5. Prepend beats 2–5 to demo-script.ts so the story leads into Scene 4. Verify with screenshots of each scene."*

### Step 3 — Scenes 0, 5, 6 + intro popup + timeline
- **Goal:** Bookend the story and add the top timeline. Intro popup (Scene 0), green container + delivery (Scenes 5–6), and a timeline bar that spans all scenes.
- **Files:** `office/src/demo/IntroModal.tsx`, `office/src/demo/TimelineBar.tsx`; container green state + Joan delivered bubble; beats 1, 10, 11.
- **Acceptance:** Popup shows on load (2–3 line purpose + "Start"); the 7-step timeline highlights the current step and is visibly full at beat 11; container flips 🟢 and Joan gets his shirt.
- **Verify:** screenshot popup, mid-story timeline, and the completed/delivered state.
- **Prompt:** *"Add `IntroModal` (Scene 0: 2–3 line purpose + Start button that begins the story), a `TimelineBar` (7 steps from the beat table; highlight current step; fill to 100% at the final beat), and Scenes 5–6 (container flips green on beat 10; Joan delivered bubble on beat 11). Match the Press Start 2P aesthetic. Verify with screenshots of popup, mid-story, and delivered states."*

### Step 4 — Stage controls & pacing
- **Goal:** Reliable live control. Play, Pause, and **Next** (manual step — primary on stage), plus keyboard shortcuts.
- **Files:** `office/src/demo/StageControls.tsx`; keyboard handling in `SceneController`.
- **Acceptance:** Space = play/pause, → = next; auto-advance respects each beat's `autoAdvanceMs`; the operator can pause anywhere and step manually; `waitForApproval` never auto-advances.
- **Verify:** run once auto, once fully manual via keyboard; confirm the approval beat waits regardless of mode.
- **Prompt:** *"Add `StageControls` (Play, Pause, Next) with keyboard shortcuts (Space, →). Auto-advance uses each beat's autoAdvanceMs but manual Next always works and Pause halts. The waitForApproval beat must never auto-advance. Verify both an auto run and a fully manual keyboard run."*

### Step 5 — Dry-run, reset & backstop
- **Goal:** A demo you can run cold, repeatedly, with zero live risk.
- **Files:** a `Reset demo` control; seed verification; a recorded screen-capture as backup.
- **Acceptance:** From a cold load, the full six-scene story runs start→finish in ≤3 min; Reset returns to Scene 0 with a clean seeded case; a recorded run exists as a fallback if the venue network fails.
- **Verify:** run end-to-end 3× back-to-back; confirm Reset works and the recording plays.
- **Prompt:** *"Add a Reset control that reseeds the case and returns to Scene 0. Verify the full story runs cold in under 3 minutes, three times back-to-back, and record a screen capture of a clean run as a backstop."*

---

## 5. Risk & fallback

| Risk | Mitigation |
|---|---|
| Live preview API hiccups mid-pitch | Everything runs seeded / DEMO_MODE; agents animate from the deterministic demo run, not a live external call. |
| Auto-timing drifts ahead of narration | Manual **Next** is the primary stage control; auto-advance is a convenience, not a dependency. |
| Approval beat auto-submits by accident | `waitForApproval` is hard-blocked; submit only fires on the human click (real Phase 3 gate). |
| Venue network dies | Phase D5 recorded run is the backstop. |
| Story reads as three features, not a chain | Timeline steps are phrased causally (call → discrepancy → fix), and pipeline beats fire in dependency order. |

---

## 6. Why this scores

- **Demo (50 %):** a coherent, watchable story a non-expert follows instantly; real pipeline underneath; controllable on stage.
- **Creativity (15 %):** agents you *watch* work, a human-in-the-loop approval beat, an individual-to-enterprise narrative — not a dashboard.
- **Impact (25 %) / Pitch (10 %):** Joan → retailer makes the buyer obvious and the pain concrete; the timeline gives the pitch its spine.

---

## 7. Definition of done

- Site opens → purpose popup → timeline → full scripted story → container green → Joan delivered → timeline 100 %.
- Agents animate from **real** WS events; the approval beat uses the **real** gate; rejection is a no-op.
- Runs cold in ≤3 min, resettable, with a recorded backstop.
- Committed in separate Demo-Mode commits and pushed to `https://github.com/yacine-baghli/ClearBorder`.

*Guardrails unchanged: portal is the local mock, `CASE_STORE=local`, secrets in `server/` only.*
