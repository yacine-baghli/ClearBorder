# ClearBorder

> **Autonomous customs-clearance agent for SME exporters and brokers.**
> Built for the RAISE Summit Hackathon (Cerebral Valley × Google DeepMind), Paris.

Most agents work from a snapshot and forget. Customs clearance takes days — an agent that forgets is useless. **ClearBorder remembers every correction and every open customs query, and each morning resumes exactly where it stopped.**

---

## The Three-Primitive Chain

```
Live Translate (call) → persistent CaseFile (discrepancy detected) → Computer Use (portal correction)
       ↓                          ↓                                           ↓
  Agent ↔ sender            State survives restart                    Amend mock portal
  translated live           (the load-bearing primitive)               human confirms before submit
```

1. **Live Translate** — ClearBorder's agent calls the sender directly with real-time translation via `gemini-3.5-live-translate-preview`. No broker needed — clarifications are captured as facts into the CaseFile.
2. **Persistent CaseFile** *(load-bearing)* — `CaseStore` interface backed by SQLite. Detects discrepancies (invoice vs packing list value mismatch, missing HS code). State survives full process restart and resumes via `environmentId`.
3. **Computer Use** — `gemini-2.5-computer-use` drives a mock EU customs portal to amend flagged entries. **Halts before Submit** — requires explicit human approval.

---

## Repository Structure

```
clearborder/
├─ packages/core/         # CaseFile types + CaseStore interface
├─ server/                # Fastify + WS backend (port 3001) — ALL secrets here
├─ console/               # Vite + React operator UI (port 5173)
├─ portal/                # Mock EU customs portal (port 5174)
├─ office/                # Pixel-agents visualization (port 5175)
└─ scripts/demo/          # Golden path demo scripts
```

## Quick Start

```bash
# Install dependencies
npm install

# Copy env template and add your Gemini API key
cp server/.env.example server/.env

# Start all four services
npm run dev
```

This starts:
| Service | URL | Purpose |
|---------|-----|---------|
| Server | `http://localhost:3001` | API + WebSocket event bus |
| Console | `http://localhost:5173` | Operator UI |
| Portal | `http://localhost:5174` | Mock customs portal |
| Office | `http://localhost:5175` | Pixel-agents visualization |

## Run Tests

```bash
npm test
```

## Environment Variables

All secrets stay in `server/.env` — never shipped to client apps.

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_API_KEY` | — | Google AI API key (server only) |
| `CASE_STORE` | `local` | `local` (SQLite) or `interactions` (preview API) |
| `DEMO_MODE` | `true` | Use recorded audio + seeded case data |
| `PORTAL_URL` | `http://localhost:5174` | Mock portal URL for Computer Use |

---

## Phase Status

| Phase | Description | Status |
|-------|-------------|--------|
| **0** | Scaffold, CaseStore, mock portal | ✅ Complete |
| **1** | Live Translate → CaseFile | ✅ Complete |
| **2** | Persistent CaseFile, cold-restart resume | ✅ Complete |
| **3** | Computer Use + human confirm gate | ⬜ Pending |
| **4** | Pixel-agents office visualization | 🔨 Groundwork done |
| **5** | End-to-end golden path + pitch | ⬜ Pending |

---

## Tech Stack

- **TypeScript** everywhere
- **Node 20 + Fastify + ws** — backend
- **Vite + React** — console, portal, office
- **better-sqlite3** — local persistence
- **@google/genai** — Live Translate, Computer Use
- **pixel-agents** — office visualization shell

## License

Hackathon project — RAISE Summit 2026.
