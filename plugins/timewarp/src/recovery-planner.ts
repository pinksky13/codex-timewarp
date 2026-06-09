import { findTimelineEvent } from "./timeline-normalizer.ts";
import type { EventBoundary, Timeline, TimelineEvent } from "./types.ts";

export function buildRecoveryPrompt(options: {
  timeline: Timeline;
  boundary: EventBoundary;
  replacement?: string;
}): string {
  const event = findTimelineEvent(options.timeline, options.boundary.eventId);
  const laterEvents = options.timeline.events.filter((candidate) => candidate.rawRef.line > event.rawRef.line);
  const linked = event.linkedEventId ? options.timeline.events.find((candidate) => candidate.eventId === event.linkedEventId) : undefined;

  const lines: string[] = [];
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

function describeEvent(event: TimelineEvent): string {
  const tool = event.toolName ? ` tool=${event.toolName}` : "";
  const call = event.callId ? ` call_id=${event.callId}` : "";
  return `${event.eventId} ${event.type}${tool}${call} risk=${event.risk} ref=${event.rawRef.path}:${event.rawRef.line}\nPreview: ${event.preview}`;
}
