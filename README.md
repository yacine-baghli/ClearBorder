# 🛃 ClearBorder

**AI-powered customs clearance that chains Live Translate, a persistent CaseFile, and Computer Use into one agent pipeline — so shipments clear faster and nothing gets lost between days.**

> Built for the RAISE Hackathon 2025 — Polytechnique

---

## 📋 Table of Contents

- [Overview](#overview)
- [The Three Primitives](#the-three-primitives)
- [Demo Mode](#demo-mode)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Development](#development)
- [Deployment](#deployment)
- [Phase Status](#phase-status)
- [License](#license)

---

## Overview

International shipments get stuck at customs because of paperwork mismatches — wrong values, missing codes, language barriers. A single container with 2,400 shirts can be held for days over a €2,250 discrepancy between an invoice and a packing list.

**ClearBorder** is a B2B customs-clearance agent that automates the entire resolution pipeline:

1. **Live Translate** captures trade facts from a multilingual supplier call
2. A **persistent CaseFile** remembers everything across sessions and detects discrepancies
3. **Computer Use** opens the customs portal and corrects the flagged fields — but only after **human approval**

No correction is ever submitted without an operator clicking "Approve".

---

## The Three Primitives

### 🗣️ Live Translate
Powered by Gemini, translates and transcribes supplier calls in real-time. Trade facts (invoice values, HS codes, weights) are captured as structured data into the CaseFile.

### 📁 Persistent CaseFile (Load-Bearing)
The CaseFile is the backbone. It stores every document, fact, discrepancy, and correction with full provenance. It survives server restarts — kill the process, restart, call `resume()`, and the entire state is byte-identical. Discrepancy detection is idempotent.

### 🖥️ Computer Use (Gemini + Playwright)
When a discrepancy is detected, a Computer Use loop opens the customs portal (a local mock), navigates to the shipment entry, and prepares the correction. It **halts before Submit** and emits a `needs_confirmation` event. Only an explicit human approval triggers submission.

---

## Demo Mode

The demo tells the story of **Joan** — a customer whose World Cup shirt is stuck at French customs — through **7 scenes** and **11 beats**:

| Scene | What Happens |
|-------|-------------|
| **0 — Intro** | ClearBorder title and tagline |
| **1 — The Stuck Order** | Joan worried about her shirt not arriving |
| **2 — Email** | Joan emails the retailer SportStyle |
| **3 — Customs Hold** | Retailer finds container HELD: value mismatch + missing HS code |
| **4 — ClearBorder Takes Over** | 🔥 **The product demo**: Translator captures facts → CaseFile detects discrepancy → Portal agent corrects → Human approves |
| **5 — Cleared!** | Green container, customs cleared |
| **6 — Delivered!** | Joan happy with her France shirt ⚽🇫🇷 |

### Controls

| Input | Action |
|-------|--------|
| `Space` | Play / Pause |
| `→` (Right Arrow) | Skip to next beat |
| `Shift + R` | Reset demo |
| Stage footer | Play, Pause, Next, Reset buttons |
| Approve / Reject | Only during human approval gate |

### Key Guarantee
**All pipeline beats call real server endpoints.** The agents in the pixel office animate from genuine WebSocket events (`fact_captured`, `discrepancy_detected`, `needs_confirmation`), not fake animations.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      office/ (Vite + React)              │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ DemoController│  │ Scene Router  │  │ Pixel Agents   │  │
│  │ (story engine)│→ │ (7 scenes)    │  │ (WS-driven)    │  │
│  └──────┬───────┘  └──────────────┘  └───────┬────────┘  │
│         │ POST /api/*                         │ WS events │
├─────────┼─────────────────────────────────────┼──────────┤
│         ▼                                     │          │
│  ┌─────────────────────────────────────────────┐         │
│  │              server/ (Fastify + Node)        │         │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │         │
│  │  │ CaseStore │ │Translate │ │ Computer Use │ │         │
│  │  │ (SQLite)  │ │ (Gemini) │ │ (Playwright) │ │         │
│  │  └──────────┘ └──────────┘ └──────────────┘ │         │
│  └─────────────────────────────────────────────┘         │
│                                                          │
│  ┌──────────────────┐                                    │
│  │  portal/ (mock)   │ ← Computer Use navigates here     │
│  │  customs portal   │                                    │
│  └──────────────────┘                                    │
└──────────────────────────────────────────────────────────┘
```

### Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/cases` | Create a new case |
| `GET` | `/api/cases/:id` | Get case by ID |
| `PATCH` | `/api/cases/:id` | Append data to case |
| `POST` | `/api/cases/:id/capture` | Capture a trade fact |
| `POST` | `/api/cases/:id/discrepancies` | Detect discrepancies |
| `POST` | `/api/cases/:id/correct` | Start Computer Use correction (halts before submit) |
| `POST` | `/api/cases/:id/confirm` | Human approves → submit |
| `POST` | `/api/cases/:id/reject` | Human rejects → nothing sent |
| `POST` | `/api/cases/resume` | Resume case by environmentId |
| `POST` | `/api/translate/demo` | Run demo translation simulation |
| `GET` | `/ws` | WebSocket for real-time events |

---

## Project Structure

```
clearborder/
├── packages/
│   └── core/                 # Shared types (CaseFile, DocKind, etc.)
│       └── src/
│           └── types.ts
├── server/                   # Fastify API + CaseStore + pipeline
│   ├── src/
│   │   ├── index.ts          # Routes + WebSocket
│   │   ├── caseStore.ts      # Persistent CaseFile (SQLite / local JSON)
│   │   ├── translate.ts      # Live Translate (Gemini)
│   │   └── computerUse.ts    # Computer Use (Playwright)
│   └── .env                  # GEMINI_API_KEY (never committed)
├── portal/                   # Mock customs portal (Vite)
│   └── src/
│       └── main.tsx
├── office/                   # Pixel-agents office + Demo Mode (Vite + React)
│   └── src/
│       ├── main.tsx          # Scene router + pixel agents
│       ├── index.css         # All styles
│       └── demo/
│           ├── types.ts      # Beat & scene type definitions
│           ├── demo-script.ts # 11-beat script across 7 scenes
│           └── DemoController.tsx # Story engine (real pipeline dispatch)
├── .env.example              # Template for environment variables
├── package.json              # Root workspace (npm workspaces)
└── README.md                 # This file
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9

### 1. Clone and Install

```bash
git clone https://github.com/yacine-baghli/clearborder.git
cd clearborder
npm install
```

### 2. Set Up Environment

```bash
cp .env.example server/.env
# Edit server/.env and add your Gemini API key:
# GEMINI_API_KEY=your-key-here
```

### 3. Run Development Server

```bash
npm run dev
```

This starts all three services concurrently:

| Service | URL | Description |
|---------|-----|-------------|
| **Server** | `http://localhost:3001` | Fastify API + WebSocket |
| **Office** | `http://localhost:5175` | Demo Mode UI |
| **Portal** | `http://localhost:5173` | Mock customs portal |

### 4. Open the Demo

Navigate to **http://localhost:5175** and click **Start Demo →**.

---

## Development

### Build for Production

```bash
npm run build
```

### Run Tests

```bash
# Cold-restart persistence test (Phase 2)
npm run test:restart

# All tests
npm test
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GEMINI_API_KEY` | Google Gemini API key | Yes (for translate) |
| `CASE_STORE` | `local` or `sqlite` | No (default: `local`) |
| `DEMO_MODE` | `true` to enable demo mode | No |
| `PORT` | Server port | No (default: `3001`) |

---

## Deployment

### Cloudflare Pages

The office UI (demo mode) can be deployed as a static site to Cloudflare Pages:

```bash
cd office
npm run build
# Deploy dist/ to Cloudflare Pages
npx wrangler pages deploy dist --project-name=clearborder
```

The server requires a Node.js runtime (Cloudflare Workers, Railway, Fly.io, etc.).

---

## Phase Status

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 0** | Scaffold + CaseStore + mock portal | ✅ Complete |
| **Phase 1** | Live Translate + Operator Console | ✅ Complete |
| **Phase 2** | Persistence (cold-restart proof) | ✅ Complete |
| **Phase 3** | Computer Use + human confirm gate | ✅ Complete |
| **Phase 4** | Pixel-agents office shell | ✅ Complete |
| **Phase 5** | Message/email system | ✅ Complete |
| **Demo Mode** | 7-scene presentation layer | ✅ Complete |

---

## License

MIT

---

<p align="center">
  <strong>ClearBorder</strong> — AI customs clearance that never forgets, never submits without permission.
</p>
