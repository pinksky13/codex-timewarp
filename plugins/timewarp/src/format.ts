import { stableStringify } from "./json.ts";
import type { Timeline, TimelineEvent } from "./types.ts";

export function formatTimeline(
  timeline: Timeline,
  options: {
    toolsOnly?: boolean;
    failedOnly?: boolean;
    turn?: number;
    limit?: number;
  } = {}
): string {
  const lines: string[] = [];
  lines.push(`Current session: ${timeline.session.sessionId}`);
  lines.push(`Transcript: ${timeline.session.path}`);
  if (timeline.session.cwd) {
    lines.push(`Workspace: ${timeline.session.cwd}`);
  }
  lines.push("");

  let events = timeline.events;
  if (options.turn !== undefined) {
    events = events.filter((event) => event.turnNumber === options.turn);
  }
  if (options.toolsOnly) {
    events = events.filter((event) => event.kind === "tool_call" || event.kind === "tool_result" || event.kind === "patch");
  }
  if (options.failedOnly) {
    events = events.filter((event) => /fail|error|denied|rejected|exit [1-9]/i.test(`${event.status || ""} ${event.preview}`));
  }
  if (options.limit !== undefined) {
    events = events.slice(Math.max(0, events.length - options.limit));
  }

  let previousTurn = -1;
  for (const event of events) {
    if (event.turnNumber !== previousTurn) {
      previousTurn = event.turnNumber;
      lines.push(`Turn ${event.turnNumber}${event.timestamp ? `  ${timeOnly(event.timestamp)}` : ""}`);
    }
    lines.push(formatTimelineRow(event));
  }

  if (events.length === 0) {
    lines.push("No matching timeline events.");
  }

  return lines.join("\n");
}

export function formatInspect(event: TimelineEvent, linked?: TimelineEvent): string {
  const lines: string[] = [];
  lines.push(`${event.eventId} ${event.type}`);
  lines.push(`Turn: ${event.turnNumber}`);
  if (event.timestamp) {
    lines.push(`Timestamp: ${event.timestamp}`);
  }
  if (event.toolName) {
    lines.push(`Tool: ${event.toolName}`);
  }
  if (event.callId) {
    lines.push(`Call ID: ${event.callId}`);
  }
  if (linked) {
    lines.push(`Linked event: ${linked.eventId} ${linked.type}`);
  }
  lines.push(`Risk: ${event.risk}`);
  lines.push(`Status: ${event.status || "n/a"}`);
  lines.push(`Raw ref: ${event.rawRef.path}:${event.rawRef.line}`);
  lines.push("");
  lines.push("Preview:");
  lines.push(event.preview);
  lines.push("");
  lines.push("Available recovery actions:");
  for (const action of availableActions(event)) {
    lines.push(`- ${action}`);
  }
  lines.push("");
  lines.push("Raw:");
  lines.push(stableStringify(event.raw));
  return lines.join("\n");
}

export function formatPrompt(prompt: string): string {
  return prompt;
}

function formatTimelineRow(event: TimelineEvent): string {
  const tool = event.toolName ? ` ${event.toolName}` : "";
  const linked = event.linkedEventId ? ` -> ${event.linkedEventId}` : "";
  const status = event.status ? ` ${event.status}` : "";
  return `  ${event.eventId} ${event.kind.padEnd(11)} ${event.type}${tool}${status}${linked} [${event.risk}]\n    ${event.preview}`;
}

function availableActions(event: TimelineEvent): string[] {
  const actions = ["inspect", "prompt --before", "prompt --after"];
  if (event.kind === "tool_result") {
    actions.push("override");
  }
  if (event.risk === "read_only") {
    actions.push("manual rerun planning");
  }
  if (event.risk === "local_workspace_mutation") {
    actions.push("transcript-only fork with workspace warning");
  }
  if (event.risk === "external_side_effect") {
    actions.push("append correction only; do not silently rerun");
  }
  return actions;
}

function timeOnly(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) {
    return timestamp;
  }
  return date.toISOString().slice(11, 19);
}
