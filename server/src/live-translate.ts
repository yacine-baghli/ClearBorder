// server/src/live-translate.ts
// Live Translate session management using @google/genai Live API
// Model: gemini-3.5-live-translate-preview
// Backend opens the session and can mint ephemeral tokens with locked translationConfig.
// All secrets stay server-side — console gets ephemeral tokens only.

import { broadcast } from "./events.ts";

// --- Types ---

export interface TranslateSessionConfig {
  targetLanguageCode: string;
  caseId: string;
}

export interface TranscriptEntry {
  direction: "in" | "out";
  text: string;
  timestamp: string;
}

interface ActiveSession {
  caseId: string;
  targetLanguageCode: string;
  transcripts: TranscriptEntry[];
  createdAt: string;
  status: "active" | "closed";
  // In production: holds the actual Gemini Live session handle
  // For demo: we simulate the session
}

// --- Session store (in-memory, one session at a time for the demo) ---
let currentSession: ActiveSession | null = null;

/**
 * Open a new Live Translate session.
 *
 * In production, this calls:
 *   ai.live.connect({
 *     model: "gemini-3.5-live-translate-preview",
 *     config: {
 *       responseModalities: [Modality.AUDIO],
 *       inputAudioTranscription: {},
 *       outputAudioTranscription: {},
 *       translationConfig: { targetLanguageCode, echoTargetLanguage: true },
 *     },
 *     callbacks: { onmessage: ... }
 *   })
 *
 * For the hackathon demo (DEMO_MODE=true), we simulate the session
 * and use seeded transcripts to drive the CaseFile.
 */
export async function openTranslateSession(
  config: TranslateSessionConfig
): Promise<{ sessionId: string; status: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  const demoMode = process.env.DEMO_MODE === "true" || !apiKey;

  currentSession = {
    caseId: config.caseId,
    targetLanguageCode: config.targetLanguageCode,
    transcripts: [],
    createdAt: new Date().toISOString(),
    status: "active",
  };

  if (!demoMode && apiKey) {
    // --- LIVE MODE: Connect to Gemini Live Translate ---
    try {
      const { GoogleGenAI, Modality } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey });

      const _session = await ai.live.connect({
        model: "gemini-3.5-live-translate-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          translationConfig: {
            targetLanguageCode: config.targetLanguageCode,
            echoTargetLanguage: true,
          },
        },
        callbacks: {
          onmessage: (m: any) => {
            const c = m.serverContent;
            if (c?.inputTranscription?.text) {
              pushTranscript("in", c.inputTranscription.text);
            }
            if (c?.outputTranscription?.text) {
              pushTranscript("out", c.outputTranscription.text);
            }
            // Stream translated audio to connected clients
            for (const p of c?.modelTurn?.parts ?? []) {
              if (p.inlineData) {
                broadcast("translated_audio", {
                  caseId: config.caseId,
                  audio: p.inlineData.data,
                  mimeType: p.inlineData.mimeType,
                });
              }
            }
          },
        },
      });

      broadcast("live_translate_active", {
        caseId: config.caseId,
        mode: "live",
        targetLanguage: config.targetLanguageCode,
      });

      return { sessionId: config.caseId, status: "live" };
    } catch (err: any) {
      console.error("Live Translate connection failed, falling back to demo mode:", err.message);
      // Fall through to demo mode
    }
  }

  // --- DEMO MODE ---
  broadcast("live_translate_active", {
    caseId: config.caseId,
    mode: "demo",
    targetLanguage: config.targetLanguageCode,
  });

  return { sessionId: config.caseId, status: "demo" };
}

/**
 * Push a transcript entry from the Live Translate session.
 * In demo mode, this is called directly by the simulated session.
 * In live mode, it's called from the Gemini callback.
 */
export function pushTranscript(direction: "in" | "out", text: string): void {
  if (!currentSession) return;

  const entry: TranscriptEntry = {
    direction,
    text,
    timestamp: new Date().toISOString(),
  };

  currentSession.transcripts.push(entry);

  broadcast("transcript", {
    caseId: currentSession.caseId,
    ...entry,
  });
}

/**
 * Simulate incoming audio in demo mode — push pre-scripted transcripts.
 * Used by the golden path demo and by the console's demo button.
 */
export async function simulateDemoCall(caseId: string): Promise<void> {
  const demoTranscripts: Array<{ direction: "in" | "out"; text: string; delayMs: number }> = [
    { direction: "in",  text: "你好，我是王明，关于那批太阳能板的出口。", delayMs: 0 },
    { direction: "out", text: "Hello, I am Wang Ming, regarding the solar panel export shipment.", delayMs: 800 },
    { direction: "in",  text: "发票金额是四万七千两百五十欧元，包含运费。", delayMs: 2000 },
    { direction: "out", text: "The invoice value is forty-seven thousand two hundred fifty euros, including freight.", delayMs: 800 },
    { direction: "in",  text: "装箱单上的金额是四万五千欧元，不含运费。", delayMs: 2000 },
    { direction: "out", text: "The packing list value is forty-five thousand euros, without freight.", delayMs: 800 },
    { direction: "in",  text: "HS编码是8541.40.90，单晶硅光伏板。", delayMs: 2000 },
    { direction: "out", text: "The HS code is 8541.40.90, monocrystalline silicon photovoltaic panels.", delayMs: 800 },
    { direction: "in",  text: "请确认申报价值包含CIF运费。", delayMs: 2000 },
    { direction: "out", text: "Please confirm the declared value includes CIF freight.", delayMs: 800 },
  ];

  // Ensure session is active
  if (!currentSession || currentSession.caseId !== caseId) {
    await openTranslateSession({ targetLanguageCode: "en", caseId });
  }

  for (const t of demoTranscripts) {
    await new Promise((resolve) => setTimeout(resolve, t.delayMs));
    pushTranscript(t.direction, t.text);
  }
}

/** Get all transcripts for the current session */
export function getTranscripts(): TranscriptEntry[] {
  return currentSession?.transcripts ?? [];
}

/** Get current session info */
export function getSessionInfo(): ActiveSession | null {
  return currentSession;
}

/** Close the current session */
export function closeSession(): void {
  if (currentSession) {
    currentSession.status = "closed";
    broadcast("live_translate_closed", { caseId: currentSession.caseId });
    currentSession = null;
  }
}

/**
 * Mint an ephemeral token for the console.
 * In production, this creates a v1alpha token with locked translationConfig
 * so the browser can stream audio directly but can't change translation settings.
 *
 * For the demo, we return a mock token since audio streaming goes through
 * the server WebSocket.
 */
export async function mintEphemeralToken(
  targetLanguageCode: string
): Promise<{ token: string; expiresAt: string }> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey && process.env.DEMO_MODE !== "true") {
    // In production: call the v1alpha ephemeral token endpoint
    // with locked translationConfig so clients can't tamper
    try {
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1alpha/models/gemini-3.5-live-translate-preview:generateEphemeralToken",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            config: {
              responseModalities: ["AUDIO"],
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              translationConfig: {
                targetLanguageCode,
                echoTargetLanguage: true,
              },
            },
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        return {
          token: data.token,
          expiresAt: data.expiresAt,
        };
      }
    } catch (err: any) {
      console.error("Ephemeral token minting failed:", err.message);
    }
  }

  // Demo fallback — return a mock token
  return {
    token: "demo-ephemeral-token",
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
}
