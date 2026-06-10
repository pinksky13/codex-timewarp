import { stableStringify } from "./json.ts";
import type { OverrideRecord, Timeline, TimelineEvent } from "./types.ts";

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
  if (timeline.session.selection?.mode === "global_fallback") {
    lines.push(`Warning: ${timeline.session.selection.warning}`);
  } else if (timeline.session.selection?.mode === "workspace_match") {
    lines.push(`Selection: workspace_match (${timeline.session.selection.matched_cwd})`);
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

export function formatInspect(
  event: TimelineEvent,
  linked?: TimelineEvent,
  options: {
    override?: OverrideRecord;
    selectorArgs?: string[];
  } = {}
): string {
  const selectorArgs = options.selectorArgs || ["--latest"];
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
  lines.push(`Risk reason: ${event.riskReason}`);
  lines.push(`Status: ${event.status || "n/a"}`);
  lines.push(`Raw ref: ${event.rawRef.path}:${event.rawRef.line}`);
  if (options.override) {
    lines.push(`Override: latest record from ${options.override.created_at}`);
  } else {
    lines.push("Override: none");
  }
  lines.push("");
  lines.push("Preview:");
  lines.push(event.preview);
  lines.push("");
  lines.push("Recommended recovery:");
  lines.push("- Hard restart before this event:");
  lines.push(`  ${formatCommand(["timewarp", "restart", "--before", event.eventId, ...selectorArgs])}`);
  lines.push("- Hard restart after this event:");
  lines.push(`  ${formatCommand(["timewarp", "restart", "--after", event.eventId, ...selectorArgs])}`);
  if (event.kind === "tool_result") {
    lines.push("- Hard restart with corrected result:");
    lines.push(`  ${formatCommand(["timewarp", "restart", "--after", event.eventId, ...selectorArgs, "--replacement", "..."])}`);
  }
  if (options.override) {
    lines.push("- Hard restart using latest override record:");
    lines.push(`  ${formatCommand(["timewarp", "restart", "--after", event.eventId, ...selectorArgs])}`);
  }
  lines.push(...riskSpecificGuidance(event));
  lines.push("");
  lines.push("Soft current-session prompt:");
  lines.push(`- ${formatCommand(["timewarp", "prompt", "--before", event.eventId, ...selectorArgs])}`);
  lines.push("  Warning: later polluted context may still influence the model.");
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
  const override = event.override ? " override" : "";
  return `  ${event.eventId} ${event.kind.padEnd(11)} ${event.type}${tool}${status}${linked} [${event.risk}${override}]\n    ${event.preview}`;
}

function riskSpecificGuidance(event: TimelineEvent): string[] {
  switch (event.risk) {
    case "read_only":
      return ["- Risk note: read-only events may be acceptable to rerun after inspection."];
    case "local_workspace_mutation":
      return ["- Risk note: inspect `git status` and relevant diffs before making edits."];
    case "external_side_effect":
      return ["- Risk note: do not rerun external side-effect events without explicit user approval."];
    case "unknown":
      return ["- Risk note: inspect arguments and outputs before choosing a recovery boundary."];
  }
}

function timeOnly(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) {
    return timestamp;
  }
  return date.toISOString().slice(11, 19);
}

function formatCommand(parts: string[]): string {
  return parts.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (value === "...") {
    return "\"...\"";
  }
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}
