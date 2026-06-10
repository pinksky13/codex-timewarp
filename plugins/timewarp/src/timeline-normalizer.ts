import { asString, isObject, stableStringify, textFromContent, truncate } from "./json.ts";
import { assessRisk } from "./risk-classifier.ts";
import type {
  JsonObject,
  ParsedTranscriptLine,
  RawSession,
  Timeline,
  TimelineEvent,
  TimelineKind
} from "./types.ts";

const VISIBLE_TYPES = new Set([
  "task_started",
  "task_complete",
  "user_message",
  "message",
  "agent_message",
  "reasoning",
  "function_call",
  "function_call_output",
  "custom_tool_call",
  "custom_tool_call_output",
  "web_search_call",
  "web_search_end",
  "patch_apply_end"
]);

export function normalizeTimeline(session: RawSession): Timeline {
  const events: TimelineEvent[] = [];
  const callIdToEventId = new Map<string, string>();
  const pendingWebSearches: string[] = [];
  const turns = new Map<string, { turnId: string; turnNumber: number; startedAt?: string; eventIds: string[] }>();
  let currentTurnId = "turn_0";
  let turnCounter = 0;

  for (const line of session.events) {
    const type = line.payloadType || "unknown";
    if (!VISIBLE_TYPES.has(type)) {
      continue;
    }

    if (type === "task_started") {
      currentTurnId = asString(line.payload.turn_id) || `turn_${turnCounter + 1}`;
      if (!turns.has(currentTurnId)) {
        turnCounter += 1;
        turns.set(currentTurnId, {
          turnId: currentTurnId,
          turnNumber: turnCounter,
          startedAt: line.timestamp,
          eventIds: []
        });
      }
    } else if (isUserPayload(line)) {
      if (currentTurnId === "turn_0" || hasUserPromptInTurn(events, currentTurnId)) {
        turnCounter += 1;
        currentTurnId = `turn_${turnCounter}`;
        turns.set(currentTurnId, {
          turnId: currentTurnId,
          turnNumber: turnCounter,
          startedAt: line.timestamp,
          eventIds: []
        });
      }
    }

    if (!turns.has(currentTurnId)) {
      turnCounter += 1;
      currentTurnId = `turn_${turnCounter}`;
      turns.set(currentTurnId, {
        turnId: currentTurnId,
        turnNumber: turnCounter,
        startedAt: line.timestamp,
        eventIds: []
      });
    }

    const eventId = `E${String(events.length + 1).padStart(3, "0")}`;
    const kind = classifyKind(type, line.payload);
    const toolName = extractToolName(type, line.payload);
    const callId = asString(line.payload.call_id);
    const riskAssessment = classifyTimelineRisk(type, toolName, line.payload, kind);
    const timelineEvent: TimelineEvent = {
      eventId,
      sessionId: session.sessionId,
      turnId: currentTurnId,
      turnNumber: turns.get(currentTurnId)?.turnNumber || turnCounter,
      kind,
      type,
      toolName,
      callId,
      status: statusFor(type, line.payload),
      timestamp: line.timestamp,
      preview: makePreview(type, line.payload, toolName),
      risk: riskAssessment.risk,
      riskReason: riskAssessment.reason,
      rawRef: {
        path: line.path,
        line: line.line
      },
      raw: line.raw
    };

    if (callId && isToolCallKind(kind)) {
      callIdToEventId.set(callId, eventId);
    }

    if (type === "web_search_call") {
      pendingWebSearches.push(eventId);
    }

    if (callId && isToolResultKind(kind)) {
      const linked = callIdToEventId.get(callId);
      if (linked) {
        timelineEvent.linkedEventId = linked;
        const call = events.find((event) => event.eventId === linked);
        if (call) {
          call.linkedEventId = eventId;
          timelineEvent.toolName = timelineEvent.toolName || call.toolName;
          timelineEvent.risk = call.risk;
          timelineEvent.riskReason = `linked result inherits call risk from ${call.eventId}: ${call.riskReason}`;
        }
      }
    } else if (type === "web_search_end") {
      const linked = pendingWebSearches.shift();
      if (linked) {
        timelineEvent.linkedEventId = linked;
        const call = events.find((event) => event.eventId === linked);
        if (call) {
          call.linkedEventId = eventId;
        }
      }
    }

    events.push(timelineEvent);
    turns.get(currentTurnId)?.eventIds.push(eventId);
  }

  return {
    session: {
      sessionId: session.sessionId,
      path: session.path,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      cwd: session.cwd,
      cliVersion: session.cliVersion,
      eventCount: session.eventCount,
      selection: session.selection
    },
    events,
    turns: Array.from(turns.values())
  };
}

export function findTimelineEvent(timeline: Timeline, eventId: string): TimelineEvent {
  const normalized = eventId.toUpperCase();
  const event = timeline.events.find((candidate) => candidate.eventId === normalized || candidate.callId === eventId);
  if (!event) {
    throw new Error(`No timeline event found for ${eventId}`);
  }
  return event;
}

function classifyKind(type: string, payload: JsonObject): TimelineKind {
  if (type === "session_meta") {
    return "session";
  }
  if (type === "task_started" || type === "task_complete") {
    return "turn";
  }
  if (type === "user_message" || (type === "message" && payload.role === "user")) {
    return "user";
  }
  if (type === "message" || type === "agent_message") {
    return "assistant";
  }
  if (type === "reasoning") {
    return "reasoning";
  }
  if (type === "function_call" || type === "custom_tool_call" || type === "web_search_call") {
    return "tool_call";
  }
  if (type === "function_call_output" || type === "custom_tool_call_output" || type === "web_search_end") {
    return "tool_result";
  }
  if (type === "patch_apply_end") {
    return "patch";
  }
  return "other";
}

function isUserPayload(line: ParsedTranscriptLine): boolean {
  return line.payloadType === "user_message" || (line.payloadType === "message" && line.payload.role === "user");
}

function hasUserPromptInTurn(events: TimelineEvent[], turnId: string): boolean {
  return events.some((event) => event.turnId === turnId && event.kind === "user");
}

function extractToolName(type: string, payload: JsonObject): string | undefined {
  if (type === "web_search_call" || type === "web_search_end") {
    return "web_search";
  }
  if (type === "patch_apply_end") {
    return "apply_patch";
  }
  return asString(payload.name) || asString(payload.tool_name);
}

function statusFor(type: string, payload: JsonObject): string | undefined {
  if (type.endsWith("_call")) {
    return "requested";
  }
  if (type.endsWith("_output") || type.endsWith("_end")) {
    return asString(payload.status) || "completed";
  }
  if (type === "task_started") {
    return "started";
  }
  if (type === "task_complete") {
    return "completed";
  }
  return asString(payload.status);
}

function makePreview(type: string, payload: JsonObject, toolName?: string): string {
  if (type === "session_meta") {
    return truncate(`session ${asString(payload.id) || ""}`);
  }
  if (type === "task_started") {
    return truncate(`task started ${asString(payload.turn_id) || ""}`);
  }
  if (type === "task_complete") {
    return "task complete";
  }
  if (type === "agent_message") {
    return truncate(asString(payload.message) || "assistant message");
  }
  if (type === "message") {
    return truncate(textFromContent(payload.content) || `${asString(payload.role) || "message"} message`);
  }
  if (type === "user_message") {
    return truncate(textFromContent(payload.content) || asString(payload.message) || "user message");
  }
  if (type === "reasoning") {
    return truncate(textFromContent(payload.summary) || "reasoning");
  }
  if (type === "function_call" || type === "custom_tool_call") {
    return truncate(`${toolName || "tool"}(${extractArgumentsPreview(payload)})`, 140);
  }
  if (type === "function_call_output" || type === "custom_tool_call_output") {
    return truncate(asString(payload.output) || stableStringify(payload.output) || "tool output", 140);
  }
  if (type === "web_search_call") {
    return truncate(`web_search ${stableStringify(payload.action || payload.query || payload)}`, 140);
  }
  if (type === "web_search_end") {
    return truncate(`web_search results ${stableStringify(payload)}`, 140);
  }
  if (type === "patch_apply_end") {
    return truncate(`patch ${stableStringify(payload)}`, 140);
  }
  return truncate(stableStringify(payload), 140);
}

function extractArgumentsPreview(payload: JsonObject): string {
  const args = payload.arguments;
  if (typeof args === "string") {
    return args;
  }
  if (isObject(args)) {
    return stableStringify(args);
  }
  return "";
}

function classifyTimelineRisk(
  eventType: string,
  toolName: string | undefined,
  payload: JsonObject,
  kind: TimelineKind
): ReturnType<typeof assessRisk> {
  if (kind !== "tool_call" && kind !== "tool_result" && kind !== "patch") {
    return {
      risk: "unknown",
      reason: "non-tool transcript event; side-effect risk is not applicable."
    };
  }
  return assessRisk({ eventType, toolName, payload });
}

function isToolCallKind(kind: TimelineKind): boolean {
  return kind === "tool_call";
}

function isToolResultKind(kind: TimelineKind): boolean {
  return kind === "tool_result" || kind === "patch";
}
