export type JsonObject = Record<string, unknown>;

export type ParsedTranscriptLine = {
  path: string;
  line: number;
  raw: JsonObject;
  timestamp?: string;
  outerType?: string;
  payloadType?: string;
  payload: JsonObject;
};

export type SessionSummary = {
  sessionId: string;
  path: string;
  startedAt?: string;
  updatedAt?: string;
  cwd?: string;
  cliVersion?: string;
  eventCount: number;
};

export type RawSession = SessionSummary & {
  events: ParsedTranscriptLine[];
};

export type TimelineKind =
  | "session"
  | "turn"
  | "user"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "patch"
  | "lifecycle"
  | "reasoning"
  | "other";

export type RiskClass = "read_only" | "local_workspace_mutation" | "external_side_effect" | "unknown";

export type TimelineEvent = {
  eventId: string;
  sessionId: string;
  turnId: string;
  turnNumber: number;
  kind: TimelineKind;
  type: string;
  toolName?: string;
  callId?: string;
  linkedEventId?: string;
  status?: string;
  timestamp?: string;
  preview: string;
  risk: RiskClass;
  rawRef: {
    path: string;
    line: number;
  };
  raw: JsonObject;
};

export type Timeline = {
  session: SessionSummary;
  events: TimelineEvent[];
  turns: Array<{
    turnId: string;
    turnNumber: number;
    startedAt?: string;
    eventIds: string[];
  }>;
};

export type EventBoundary =
  | {
      side: "before";
      eventId: string;
    }
  | {
      side: "after";
      eventId: string;
    };

export type OverrideRecord = {
  type: "timewarp_override";
  target_event_id: string;
  session_id: string;
  override_kind: "tool_result";
  author: "user";
  replacement: string;
  created_at: string;
};
