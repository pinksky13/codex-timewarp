import { findTimelineEvent } from "./timeline-normalizer.ts";
import { asString, isObject, stableStringify, textFromContent } from "./json.ts";
import type { EventBoundary, Timeline, TimelineEvent } from "./types.ts";

const DEFAULT_RESTART_MAX_CHARS = 12_000;
const DEFAULT_RESTART_PREVIEW_CHARS = 800;
const DEFAULT_RESTART_CONTEXT_ITEM_CHARS = 2_400;
const DEFAULT_RESTART_REPLACEMENT_CHARS = 4_000;

export type RestartContextItem = {
  eventId: string;
  line: number;
  priority: number;
  role: "user_intent" | "assistant_context" | "tool_call" | "tool_result" | "patch";
  title: string;
  body: string;
  rawRef: {
    path: string;
    line: number;
  };
};

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
  maxContextItemChars?: number;
  maxReplacementChars?: number;
}): RestartRecoveryPackResult {
  const maxChars = options.maxChars ?? DEFAULT_RESTART_MAX_CHARS;
  const maxEventPreviewChars = options.maxEventPreviewChars ?? DEFAULT_RESTART_PREVIEW_CHARS;
  const maxContextItemChars = options.maxContextItemChars ?? DEFAULT_RESTART_CONTEXT_ITEM_CHARS;
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
  const contextItems = extractRestartContext(options.timeline, options.boundary, {
    maxContextItemChars
  });

  let includedContextItems = contextItems;
  let omittedContextEventCount = 0;
  let recoveryPack = assembleRestartRecoveryPack({
    timeline: options.timeline,
    boundary: options.boundary,
    event,
    linked,
    replacement,
    invalidatedEvents,
    includedContextItems,
    omittedContextEventCount,
    maxEventPreviewChars
  });

  while (recoveryPack.length > maxChars && includedContextItems.length > 0) {
    const nextContextItems = removeLowestPriorityContextItem(includedContextItems);
    if (nextContextItems.length === includedContextItems.length) {
      break;
    }
    includedContextItems = nextContextItems;
    omittedContextEventCount += 1;
    recoveryPack = assembleRestartRecoveryPack({
      timeline: options.timeline,
      boundary: options.boundary,
      event,
      linked,
      replacement,
      invalidatedEvents,
      includedContextItems,
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

export function extractRestartContext(
  timeline: Timeline,
  boundary: EventBoundary,
  options: {
    maxContextItemChars?: number;
  } = {}
): RestartContextItem[] {
  const maxContextItemChars = options.maxContextItemChars ?? DEFAULT_RESTART_CONTEXT_ITEM_CHARS;
  const event = findTimelineEvent(timeline, boundary.eventId);
  const validEvents = timeline.events.filter((candidate) =>
    boundary.side === "after" ? candidate.rawRef.line <= event.rawRef.line : candidate.rawRef.line < event.rawRef.line
  );
  const selectedLinkedEventId = event.linkedEventId;

  const items: RestartContextItem[] = [];
  for (const candidate of validEvents) {
    if (candidate.eventId === event.eventId) {
      continue;
    }
    const item = contextItemForEvent(candidate, {
      maxContextItemChars,
      selectedLinkedEventId,
      boundaryLine: event.rawRef.line
    });
    if (item) {
      items.push(item);
    }
  }

  return items.sort((left, right) => left.line - right.line);
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
  includedContextItems: RestartContextItem[];
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
  if (options.includedContextItems.length === 0) {
    lines.push("- No meaningful pre-boundary events were included.");
  } else {
    for (const contextItem of options.includedContextItems) {
      lines.push(formatRestartContextItem(contextItem));
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

function formatRestartContextItem(item: RestartContextItem): string {
  return `- ${item.eventId} ${item.role} priority=${item.priority} ref=${item.rawRef.path}:${item.rawRef.line}\n  ${item.title}\n  ${indentBody(item.body)}`;
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

function truncateMultiline(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const suffix = "\n[truncated]";
  return `${value.slice(0, Math.max(0, maxLength - suffix.length))}${suffix}`;
}

function contextItemForEvent(
  event: TimelineEvent,
  options: {
    maxContextItemChars: number;
    selectedLinkedEventId?: string;
    boundaryLine: number;
  }
): RestartContextItem | undefined {
  const role = contextRole(event);
  if (!role) {
    return undefined;
  }

  const body = contextBody(event);
  if (!body) {
    return undefined;
  }

  return {
    eventId: event.eventId,
    line: event.rawRef.line,
    priority: contextPriority(event, role, options),
    role,
    title: contextTitle(event),
    body: truncateMultiline(body, options.maxContextItemChars),
    rawRef: event.rawRef
  };
}

function contextRole(event: TimelineEvent): RestartContextItem["role"] | undefined {
  if (event.kind === "user") {
    return "user_intent";
  }
  if (event.kind === "assistant" && isUsefulAssistantContext(event)) {
    return "assistant_context";
  }
  if (event.kind === "tool_call") {
    return "tool_call";
  }
  if (event.kind === "tool_result") {
    return "tool_result";
  }
  if (event.kind === "patch") {
    return "patch";
  }
  return undefined;
}

function contextPriority(
  event: TimelineEvent,
  role: RestartContextItem["role"],
  options: {
    selectedLinkedEventId?: string;
    boundaryLine: number;
  }
): number {
  if (event.eventId === options.selectedLinkedEventId) {
    return 95;
  }

  const nearBoundaryBonus = Math.max(0, 10 - Math.floor(Math.max(0, options.boundaryLine - event.rawRef.line) / 3));
  switch (role) {
    case "user_intent":
      return 100 + nearBoundaryBonus;
    case "assistant_context":
      return 75 + nearBoundaryBonus;
    case "tool_call":
      return 70 + nearBoundaryBonus;
    case "patch":
      return 68 + nearBoundaryBonus;
    case "tool_result":
      return 60 + nearBoundaryBonus;
  }
}

function contextTitle(event: TimelineEvent): string {
  const tool = event.toolName ? ` tool=${event.toolName}` : "";
  const call = event.callId ? ` call_id=${event.callId}` : "";
  return `turn=${event.turnNumber} ${event.kind} ${event.type}${tool}${call} risk=${event.risk}`;
}

function contextBody(event: TimelineEvent): string | undefined {
  const payload = rawPayload(event);
  if (event.kind === "user") {
    return textFromContent(payload.content) || asString(payload.message) || event.preview;
  }
  if (event.kind === "assistant") {
    return textFromContent(payload.content) || asString(payload.message) || event.preview;
  }
  if (event.kind === "tool_call") {
    return formatToolCallBody(payload);
  }
  if (event.kind === "tool_result") {
    return asString(payload.output) || stableStringify(payload.output) || stableStringify(payload);
  }
  if (event.kind === "patch") {
    return stableStringify(payload);
  }
  return undefined;
}

function rawPayload(event: TimelineEvent): Record<string, unknown> {
  const payload = isObject(event.raw.payload) ? event.raw.payload : event.raw;
  return payload;
}

function formatToolCallBody(payload: Record<string, unknown>): string {
  const args = payload.arguments;
  if (typeof args === "string") {
    return args;
  }
  if (isObject(args)) {
    return stableStringify(args);
  }
  return stableStringify(payload);
}

function isUsefulAssistantContext(event: TimelineEvent): boolean {
  const text = contextBody(event) || "";
  return /\b(plan|summary|decision|decide|requirement|next|final|instruction|approach|todo|will|need)\b/i.test(text);
}

function indentBody(value: string): string {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function removeLowestPriorityContextItem(items: RestartContextItem[]): RestartContextItem[] {
  const latestUserLine = Math.max(...items.filter((item) => item.role === "user_intent").map((item) => item.line));
  const removableIndexes = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.priority < 95 && !(item.role === "user_intent" && item.line === latestUserLine));

  if (removableIndexes.length === 0) {
    return items;
  }

  let removeIndex = removableIndexes[0].index;
  for (const { index } of removableIndexes.slice(1)) {
    const current = items[index];
    const removable = items[removeIndex];
    if (current.priority < removable.priority || (current.priority === removable.priority && current.line < removable.line)) {
      removeIndex = index;
    }
  }
  return items.filter((_, index) => index !== removeIndex);
}
