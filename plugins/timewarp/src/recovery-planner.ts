import { findTimelineEvent } from "./timeline-normalizer.ts";
import type { EventBoundary, Timeline, TimelineEvent } from "./types.ts";

const DEFAULT_RESTART_MAX_CHARS = 12_000;
const DEFAULT_RESTART_PREVIEW_CHARS = 800;
const DEFAULT_RESTART_REPLACEMENT_CHARS = 4_000;

export type RestartRecoveryPackResult = {
  recoveryPack: string;
  warnings: string[];
  omittedContextEventCount: number;
  invalidatedEventCount: number;
};

export function buildRecoveryPrompt(options: {
  timeline: Timeline;
  boundary: EventBoundary;
  replacement?: string;
}): string {
  const event = findTimelineEvent(options.timeline, options.boundary.eventId);
  const laterEvents = options.timeline.events.filter((candidate) => candidate.rawRef.line > event.rawRef.line);
  const linked = event.linkedEventId ? options.timeline.events.find((candidate) => candidate.eventId === event.linkedEventId) : undefined;

  const lines: string[] = [];
  lines.push("SOFT TIMEWARP RECOVERY PROMPT");
  lines.push("");
  lines.push("Warning: if this prompt is pasted into the same Codex session, later polluted context may still influence the model.");
  lines.push("For hard recovery, run `timewarp restart` and paste the recovery pack into a clean `/new` or `/clear` conversation.");
  lines.push("");
  lines.push(`Continue this Codex task from ${options.boundary.side} timeline event ${event.eventId}.`);
  lines.push("");
  lines.push("Recovery boundary:");
  lines.push(describeEvent(event));
  if (linked) {
    lines.push(`Linked event: ${describeEvent(linked)}`);
  }
  lines.push("");
  lines.push("Safety constraints:");
  lines.push("- Treat this as transcript-only recovery.");
  lines.push("- Do not assume workspace files were restored.");
  lines.push("- Do not rely on later events as authoritative state.");
  lines.push("- Use later events only as diagnostic context if they help explain the failure.");
  if (event.risk !== "read_only") {
    lines.push(`- The selected event is classified as ${event.risk}; do not rerun it without explicit approval and a checkpoint.`);
  }
  if (laterEvents.length > 0) {
    lines.push(`- Later transcript range starts at ${laterEvents[0].eventId} and ends at ${laterEvents.at(-1)?.eventId}.`);
  }
  if (options.replacement) {
    lines.push("");
    lines.push("Corrected tool result supplied by the user:");
    lines.push(options.replacement);
  }
  lines.push("");
  lines.push("Please continue from this recovery boundary and explain any workspace-state assumptions before making edits.");

  return lines.join("\n");
}

export function buildForkPrompt(timeline: Timeline, boundary: EventBoundary): string {
  return buildRecoveryPrompt({ timeline, boundary });
}

export function buildRestartRecoveryPack(options: {
  timeline: Timeline;
  boundary: EventBoundary;
  replacement?: string;
  allowLargeReplacement?: boolean;
  maxChars?: number;
  maxEventPreviewChars?: number;
  maxReplacementChars?: number;
}): RestartRecoveryPackResult {
  const maxChars = options.maxChars ?? DEFAULT_RESTART_MAX_CHARS;
  const maxEventPreviewChars = options.maxEventPreviewChars ?? DEFAULT_RESTART_PREVIEW_CHARS;
  const maxReplacementChars = options.maxReplacementChars ?? DEFAULT_RESTART_REPLACEMENT_CHARS;
  const event = findTimelineEvent(options.timeline, options.boundary.eventId);
  const validEvents = options.timeline.events.filter((candidate) =>
    options.boundary.side === "after" ? candidate.rawRef.line <= event.rawRef.line : candidate.rawRef.line < event.rawRef.line
  );
  const linked = event.linkedEventId ? validEvents.find((candidate) => candidate.eventId === event.linkedEventId) : undefined;
  const invalidatedEvents = options.timeline.events.filter((candidate) =>
    options.boundary.side === "after" ? candidate.rawRef.line > event.rawRef.line : candidate.rawRef.line >= event.rawRef.line
  );
  const warnings = ["Start a clean Codex conversation before using this pack."];
  const replacement = prepareReplacement(options.replacement, {
    allowLargeReplacement: options.allowLargeReplacement,
    maxReplacementChars,
    warnings
  });
  const contextEvents = validEvents.filter(isRestartContextEvent);

  let includedContextEvents = contextEvents;
  let omittedContextEventCount = 0;
  let recoveryPack = assembleRestartRecoveryPack({
    timeline: options.timeline,
    boundary: options.boundary,
    event,
    linked,
    replacement,
    invalidatedEvents,
    includedContextEvents,
    omittedContextEventCount,
    maxEventPreviewChars
  });

  while (recoveryPack.length > maxChars && includedContextEvents.length > 0) {
    includedContextEvents = includedContextEvents.slice(1);
    omittedContextEventCount += 1;
    recoveryPack = assembleRestartRecoveryPack({
      timeline: options.timeline,
      boundary: options.boundary,
      event,
      linked,
      replacement,
      invalidatedEvents,
      includedContextEvents,
      omittedContextEventCount,
      maxEventPreviewChars
    });
  }

  if (recoveryPack.length > maxChars) {
    warnings.push(`Recovery pack exceeds ${maxChars} characters because fixed sections are too large.`);
  } else if (omittedContextEventCount > 0) {
    warnings.push(`${omittedContextEventCount} earlier context event(s) were omitted to keep the recovery pack under ${maxChars} characters.`);
  }

  return {
    recoveryPack,
    warnings,
    omittedContextEventCount,
    invalidatedEventCount: invalidatedEvents.length
  };
}

function describeEvent(event: TimelineEvent): string {
  const tool = event.toolName ? ` tool=${event.toolName}` : "";
  const call = event.callId ? ` call_id=${event.callId}` : "";
  return `${event.eventId} ${event.type}${tool}${call} risk=${event.risk} ref=${event.rawRef.path}:${event.rawRef.line}\nPreview: ${event.preview}`;
}

function assembleRestartRecoveryPack(options: {
  timeline: Timeline;
  boundary: EventBoundary;
  event: TimelineEvent;
  linked?: TimelineEvent;
  replacement?: string;
  invalidatedEvents: TimelineEvent[];
  includedContextEvents: TimelineEvent[];
  omittedContextEventCount: number;
  maxEventPreviewChars: number;
}): string {
  const lines: string[] = [];
  lines.push("TIMEWARP RECOVERY PACK");
  lines.push("");
  lines.push("Do not paste this into the old Codex session. Start a clean conversation with");
  lines.push("/new or /clear first, then paste this whole recovery pack.");
  lines.push("");
  lines.push("Source:");
  lines.push(`- Session: ${options.timeline.session.sessionId}`);
  lines.push(`- Transcript: ${options.timeline.session.path}`);
  if (options.timeline.session.cwd) {
    lines.push(`- Workspace at recording time: ${options.timeline.session.cwd}`);
  }
  lines.push("");
  lines.push("Recovery boundary:");
  lines.push(`- Side: ${options.boundary.side}`);
  lines.push(`- Event: ${formatEventTitle(options.event)}`);
  if (options.linked) {
    lines.push(`- Linked event: ${formatEventTitle(options.linked)}`);
  }
  lines.push(`- Risk: ${options.event.risk}`);
  lines.push(`- Ref: ${options.event.rawRef.path}:${options.event.rawRef.line}`);
  lines.push(`- Preview: ${truncateMultiline(options.event.preview, options.maxEventPreviewChars)}`);

  if (options.replacement !== undefined) {
    lines.push("");
    lines.push("Corrected tool result:");
    lines.push(options.replacement);
  }

  lines.push("");
  lines.push("Valid prior context:");
  if (options.omittedContextEventCount > 0) {
    lines.push(`- ${options.omittedContextEventCount} earlier meaningful event(s) omitted to fit the recovery pack size limit.`);
  }
  if (options.includedContextEvents.length === 0) {
    lines.push("- No meaningful pre-boundary events were included.");
  } else {
    for (const contextEvent of options.includedContextEvents) {
      lines.push(formatContextEvent(contextEvent, options.maxEventPreviewChars));
    }
  }

  lines.push("");
  lines.push("Invalidated context:");
  lines.push(formatInvalidationRule(options.boundary, options.event, options.invalidatedEvents));

  lines.push("");
  lines.push("Workspace assumptions:");
  lines.push("- The working tree may still include file changes made after the selected boundary in the old session.");
  lines.push("- This recovery pack does not restore files, rewrite transcripts, roll back external side effects, or rerun tools.");
  lines.push("- Inspect git status and relevant diffs before editing.");

  lines.push("");
  lines.push("Next step:");
  lines.push("Inspect current workspace state before edits, then continue from the corrected boundary.");

  return lines.join("\n");
}

function formatEventTitle(event: TimelineEvent): string {
  const tool = event.toolName ? ` tool=${event.toolName}` : "";
  const call = event.callId ? ` call_id=${event.callId}` : "";
  return `${event.eventId} ${event.type}${tool}${call}`;
}

function formatContextEvent(event: TimelineEvent, maxPreviewChars: number): string {
  const tool = event.toolName ? ` tool=${event.toolName}` : "";
  const call = event.callId ? ` call_id=${event.callId}` : "";
  return `- ${event.eventId} turn=${event.turnNumber} ${event.kind} ${event.type}${tool}${call} risk=${event.risk} ref=${event.rawRef.path}:${event.rawRef.line}\n  Preview: ${truncateMultiline(event.preview, maxPreviewChars)}`;
}

function formatInvalidationRule(boundary: EventBoundary, event: TimelineEvent, invalidatedEvents: TimelineEvent[]): string {
  const range = invalidatedEvents.length > 0 ? ` Invalidated range: ${invalidatedEvents[0].eventId}..${invalidatedEvents.at(-1)?.eventId}.` : "";
  if (boundary.side === "before") {
    return `The selected event ${event.eventId} and all later transcript events are diagnostic only. Do not rely on them as authoritative task state, implementation state, test results, or user intent.${range}`;
  }
  return `All transcript events after ${event.eventId} are diagnostic only. Do not rely on them as authoritative task state, implementation state, test results, or user intent.${range}`;
}

function prepareReplacement(
  replacement: string | undefined,
  options: {
    allowLargeReplacement?: boolean;
    maxReplacementChars: number;
    warnings: string[];
  }
): string | undefined {
  if (replacement === undefined) {
    return undefined;
  }
  if (options.allowLargeReplacement || replacement.length <= options.maxReplacementChars) {
    return replacement;
  }

  options.warnings.push(`Corrected tool result was truncated to ${options.maxReplacementChars} characters. Re-run with --allow-large to include it in full.`);
  return truncateMultiline(replacement, options.maxReplacementChars);
}

function isRestartContextEvent(event: TimelineEvent): boolean {
  return event.kind === "user" || event.kind === "assistant" || event.kind === "tool_call" || event.kind === "tool_result" || event.kind === "patch";
}

function truncateMultiline(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const suffix = "\n[truncated]";
  return `${value.slice(0, Math.max(0, maxLength - suffix.length))}${suffix}`;
}
