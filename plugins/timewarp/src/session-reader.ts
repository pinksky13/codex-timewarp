import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { asString, isObject } from "./json.ts";
import { getSessionRoot } from "./paths.ts";
import type { JsonObject, ParsedTranscriptLine, RawSession, SessionSummary } from "./types.ts";

export async function discoverSessionFiles(root = getSessionRoot()): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && /^rollout-.+\.jsonl$/.test(entry.name)) {
        found.push(resolve(fullPath));
      }
    }
  }

  await walk(root);
  return found.sort();
}

export async function listSessions(root = getSessionRoot()): Promise<SessionSummary[]> {
  const files = await discoverSessionFiles(root);
  const summaries = await Promise.all(files.map((file) => summarizeSessionFile(file)));
  return summaries.sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""));
}

export async function readSessionByPath(path: string): Promise<RawSession> {
  const resolved = resolve(path);
  const lines = await parseJsonl(resolved);
  return buildRawSession(resolved, lines);
}

export async function readLatestSession(root = getSessionRoot()): Promise<RawSession> {
  const sessions = await listSessions(root);
  if (sessions.length === 0) {
    throw new Error(`No Codex session transcripts found under ${root}`);
  }
  return readSessionByPath(sessions[0].path);
}

export async function readSessionById(sessionId: string, root = getSessionRoot()): Promise<RawSession> {
  const sessions = await listSessions(root);
  const match = sessions.find((session) => session.sessionId === sessionId);
  if (!match) {
    throw new Error(`No Codex session found for id ${sessionId}`);
  }
  return readSessionByPath(match.path);
}

export async function resolveSession(options: {
  sessionId?: string;
  path?: string;
  latest?: boolean;
  root?: string;
}): Promise<RawSession> {
  if (options.path) {
    return readSessionByPath(options.path);
  }
  if (options.sessionId) {
    return readSessionById(options.sessionId, options.root);
  }
  return readLatestSession(options.root);
}

async function summarizeSessionFile(path: string): Promise<SessionSummary> {
  const lines = await parseJsonl(path);
  const session = await buildRawSession(path, lines);
  return {
    sessionId: session.sessionId,
    path: session.path,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    cwd: session.cwd,
    cliVersion: session.cliVersion,
    eventCount: session.eventCount
  };
}

async function parseJsonl(path: string): Promise<ParsedTranscriptLine[]> {
  const body = await readFile(path, "utf8");
  const parsed: ParsedTranscriptLine[] = [];
  const rows = body.split(/\r?\n/);

  for (let index = 0; index < rows.length; index += 1) {
    const line = rows[index].trim();
    if (!line) {
      continue;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${path}:${index + 1}: invalid JSONL row: ${message}`);
    }

    if (!isObject(raw)) {
      throw new Error(`${path}:${index + 1}: expected JSON object`);
    }

    parsed.push(normalizeTranscriptLine(path, index + 1, raw));
  }

  return parsed;
}

function normalizeTranscriptLine(path: string, line: number, raw: JsonObject): ParsedTranscriptLine {
  const payload = isObject(raw.payload) ? raw.payload : raw;
  const timestamp = asString(raw.timestamp) || asString(payload.timestamp);
  const outerType = asString(raw.type);
  const payloadType = asString(payload.type) || outerType;

  return {
    path,
    line,
    raw,
    timestamp,
    outerType,
    payloadType,
    payload
  };
}

async function buildRawSession(path: string, events: ParsedTranscriptLine[]): Promise<RawSession> {
  const meta = events.find((event) => event.payloadType === "session_meta")?.payload;
  const metaPayload = isObject(meta?.payload) ? meta.payload : meta;
  const fileId = inferSessionIdFromPath(path);
  const sessionId = asString(metaPayload?.id) || fileId;
  const timestamps = events.map((event) => event.timestamp).filter(Boolean) as string[];
  const fileUpdatedAt = timestamps.at(-1);

  return {
    sessionId,
    path,
    startedAt: asString(metaPayload?.timestamp) || timestamps[0],
    updatedAt: fileUpdatedAt || (await mtimeIso(path)),
    cwd: asString(metaPayload?.cwd),
    cliVersion: asString(metaPayload?.cli_version),
    eventCount: events.length,
    events
  };
}

function inferSessionIdFromPath(path: string): string {
  const match = path.match(/rollout-.+-(019[0-9a-f-]+)\.jsonl$/i);
  return match?.[1] || path;
}

function isNotFound(error: unknown): boolean {
  return isObject(error) && error.code === "ENOENT";
}

async function mtimeIso(path: string): Promise<string | undefined> {
  try {
    return (await stat(path)).mtime.toISOString();
  } catch {
    return undefined;
  }
}
