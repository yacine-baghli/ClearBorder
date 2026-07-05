// =====================================================
// Demo Mode — Types (Scene-based)
// =====================================================

/** Scene identifiers */
export type SceneId = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Beat types */
export type BeatType =
  | "intro"
  | "speech"
  | "emailSent"
  | "containerStatus"
  | "pipeline"
  | "waitForApproval";

/** Pipeline sub-actions that trigger real server endpoints */
export type PipelineAction = "translate" | "detect" | "computerUse";

/** Container visual state */
export type ContainerState = "neutral" | "held" | "cleared";

/** Base beat shape */
export interface BeatBase {
  id: number;
  scene: SceneId;
  step: string;
  actor: string;
  type: BeatType;
  autoAdvanceMs?: number;
  requiresApproval?: boolean;
}

export interface IntroBeat extends BeatBase {
  type: "intro";
  payload: { title: string; body: string; buttonLabel: string };
}

export interface SpeechBeat extends BeatBase {
  type: "speech";
  payload: { character: string; text: string; emotion?: "neutral" | "worried" | "happy" };
}

export interface EmailSentBeat extends BeatBase {
  type: "emailSent";
  payload: { from: string; to: string; subject: string; body: string };
}

export interface ContainerStatusBeat extends BeatBase {
  type: "containerStatus";
  payload: { status: ContainerState; label: string; retailerSpeech?: string };
}

export interface PipelineBeat extends BeatBase {
  type: "pipeline";
  payload: { action: PipelineAction; description: string };
}

export interface WaitForApprovalBeat extends BeatBase {
  type: "waitForApproval";
  requiresApproval: true;
  payload: { prompt: string };
}

export type Beat =
  | IntroBeat
  | SpeechBeat
  | EmailSentBeat
  | ContainerStatusBeat
  | PipelineBeat
  | WaitForApprovalBeat;

export type DemoState = "idle" | "playing" | "paused" | "waitingApproval" | "complete";
