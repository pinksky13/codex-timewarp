import { readFile } from "node:fs/promises";
import { formatInspect, formatPrompt, formatTimeline } from "./format.ts";
import { appendOverride } from "./overrides.ts";
import { buildForkPrompt, buildRecoveryPrompt, buildRestartRecoveryPack } from "./recovery-planner.ts";
import { resolveSession } from "./session-reader.ts";
import { findTimelineEvent, normalizeTimeline } from "./timeline-normalizer.ts";
import type { EventBoundary, Timeline } from "./types.ts";

type ParsedArgs = {
  command: string;
  positional: string[];
  flags: Map<string, string | boolean>;
};

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (args.command === "help" || args.flags.has("help") || args.flags.has("h")) {
    printHelp();
    return;
  }

  switch (args.command) {
    case "sessions":
      await commandSessions(args);
      return;
    case "show":
      await commandShow(args);
      return;
    case "inspect":
      await commandInspect(args);
      return;
    case "prompt":
    case "fork":
      await commandPrompt(args);
      return;
    case "restart":
      await commandRestart(args);
      return;
    case "override":
      await commandOverride(args);
      return;
    default:
      throw new Error(`Unknown command: ${args.command || "(missing)"}. Run timewarp help.`);
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "show", ...rest] = argv;
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      flags.set(rawKey, inlineValue);
      continue;
    }

    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(rawKey, next);
      index += 1;
    } else {
      flags.set(rawKey, true);
    }
  }

  return { command, positional, flags };
}

async function commandSessions(args: ParsedArgs): Promise<void> {
  const { listSessions } = await import("./session-reader.ts");
  const root = stringFlag(args, "root");
  const sessions = await listSessions(root);
  if (booleanFlag(args, "json")) {
    printJson(sessions);
    return;
  }

  for (const session of sessions) {
    console.log(`${session.sessionId}  ${session.updatedAt || "unknown"}  ${session.path}`);
  }
}

async function commandShow(args: ParsedArgs): Promise<void> {
  const timeline = await loadTimeline(args);
  if (booleanFlag(args, "json")) {
    printJson(timeline);
    return;
  }
  console.log(
    formatTimeline(timeline, {
      toolsOnly: booleanFlag(args, "tools-only"),
      failedOnly: booleanFlag(args, "failed"),
      turn: numberFlag(args, "turn"),
      limit: numberFlag(args, "limit")
    })
  );
}

async function commandInspect(args: ParsedArgs): Promise<void> {
  const eventId = args.positional[0];
  if (!eventId) {
    throw new Error("inspect requires an event id, for example: timewarp inspect E031");
  }
  const timeline = await loadTimeline(args);
  const event = findTimelineEvent(timeline, eventId);
  const linked = event.linkedEventId ? timeline.events.find((candidate) => candidate.eventId === event.linkedEventId) : undefined;

  if (booleanFlag(args, "json")) {
    printJson({ event, linked });
    return;
  }

  console.log(formatInspect(event, linked));
}

async function commandPrompt(args: ParsedArgs): Promise<void> {
  const timeline = await loadTimeline(args);
  const boundary = parseBoundary(args);
  const replacement = await replacementFromArgs(args);
  const prompt =
    args.command === "fork"
      ? buildForkPrompt(timeline, boundary)
      : buildRecoveryPrompt({
          timeline,
          boundary,
          replacement
        });

  if (booleanFlag(args, "json")) {
    printJson({ prompt, boundary });
    return;
  }

  console.log(formatPrompt(prompt));
}

async function commandRestart(args: ParsedArgs): Promise<void> {
  const timeline = await loadTimeline(args);
  const boundary = parseBoundary(args);
  const replacement = await replacementFromArgs(args);
  const pack = buildRestartRecoveryPack({
    timeline,
    boundary,
    replacement,
    allowLargeReplacement: booleanFlag(args, "allow-large")
  });
  const copyResult = booleanFlag(args, "copy") ? await copyRecoveryPack(pack.recoveryPack) : { copied: false as const };
  const warnings = [...pack.warnings];

  if ("warning" in copyResult) {
    warnings.push(copyResult.warning);
  }

  if (booleanFlag(args, "json")) {
    printJson({
      mode: "restart",
      session_id: timeline.session.sessionId,
      boundary: {
        side: boundary.side,
        event_id: boundary.eventId
      },
      recovery_pack: pack.recoveryPack,
      copied: copyResult.copied,
      warnings
    });
    return;
  }

  console.log(pack.recoveryPack);
  if ("command" in copyResult) {
    console.log("");
    console.log(`Copied recovery pack to clipboard with ${copyResult.command}.`);
  } else if ("warning" in copyResult) {
    console.log("");
    console.warn(`Warning: ${copyResult.warning}`);
  }
}

async function commandOverride(args: ParsedArgs): Promise<void> {
  const target = args.positional[0];
  if (!target) {
    throw new Error("override requires a target event id, for example: timewarp override E032 --replacement '...'");
  }
  const replacement = await replacementFromArgs(args);
  if (!replacement) {
    throw new Error("override requires --replacement, --replacement-file, or stdin via --stdin");
  }

  const timeline = await loadTimeline(args);
  const event = findTimelineEvent(timeline, target);
  const record = await appendOverride({
    target_event_id: event.eventId,
    session_id: timeline.session.sessionId,
    replacement
  });
  const prompt = buildRecoveryPrompt({
    timeline,
    boundary: {
      side: "after",
      eventId: event.eventId
    },
    replacement
  });

  if (booleanFlag(args, "json")) {
    printJson({ override: record, prompt });
    return;
  }

  console.log(`Wrote override for ${event.eventId} in session ${timeline.session.sessionId}.`);
  console.log("");
  console.log(prompt);
}

async function loadTimeline(args: ParsedArgs): Promise<Timeline> {
  const raw = await resolveSession({
    sessionId: stringFlag(args, "session"),
    path: stringFlag(args, "path"),
    latest: booleanFlag(args, "latest"),
    root: stringFlag(args, "root")
  });
  return normalizeTimeline(raw);
}

function parseBoundary(args: ParsedArgs): EventBoundary {
  const before = stringFlag(args, "before");
  if (before) {
    return { side: "before", eventId: before };
  }
  const after = stringFlag(args, "after");
  if (after) {
    return { side: "after", eventId: after };
  }
  const positional = args.positional[0];
  if (positional) {
    return { side: "before", eventId: positional };
  }
  throw new Error(`${args.command} requires --before EID or --after EID`);
}

async function replacementFromArgs(args: ParsedArgs): Promise<string | undefined> {
  const direct = stringFlag(args, "replacement");
  if (direct !== undefined) {
    return direct;
  }
  const file = stringFlag(args, "replacement-file");
  if (file) {
    return readFile(file, "utf8");
  }
  if (booleanFlag(args, "stdin")) {
    const { readStdin } = await import("./stdin.ts");
    return readStdin();
  }
  return undefined;
}

async function copyRecoveryPack(recoveryPack: string): Promise<
  | {
      copied: true;
      command: string;
    }
  | {
      copied: false;
      warning?: string;
    }
> {
  const { copyToClipboard } = await import("./clipboard.ts");
  return copyToClipboard(recoveryPack);
}

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function booleanFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

function numberFlag(args: ParsedArgs, name: string): number | undefined {
  const value = stringFlag(args, name);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return parsed;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp(): void {
  console.log(`Codex Timewarp

Usage:
  timewarp sessions [--json]
  timewarp show [--latest] [--session <id>] [--path <jsonl>] [--tools-only] [--failed] [--turn <n>] [--limit <n>] [--json]
  timewarp inspect <event-id> [--latest|--session <id>|--path <jsonl>] [--json]
  timewarp prompt --before <event-id> [--replacement <text>] [--json]
  timewarp prompt --after <event-id> [--replacement <text>] [--json]
  timewarp restart --before <event-id> [--replacement <text>|--replacement-file <path>|--stdin] [--copy] [--json]
  timewarp restart --after <event-id> [--replacement <text>|--replacement-file <path>|--stdin] [--copy] [--allow-large] [--json]
  timewarp fork --before <event-id> [--json]
  timewarp override <event-id> --replacement <text> [--json]

Safety:
  This MVP never rewrites original Codex session transcripts and never restores workspace files.`);
}
