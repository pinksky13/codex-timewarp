import type { JsonObject, RiskClass } from "./types.ts";
import { asString, isObject, stableStringify } from "./json.ts";

const READ_ONLY_TOOLS = new Set([
  "read",
  "grep",
  "glob",
  "ls",
  "webfetch",
  "websearch",
  "find",
  "open",
  "screenshot",
  "weather",
  "finance",
  "sports",
  "time"
]);

const MUTATING_TOOLS = new Set([
  "write",
  "edit",
  "multiedit",
  "apply_patch",
  "delete_content",
  "post",
  "reply",
  "like",
  "follow",
  "unfollow"
]);

const EXTERNAL_HINTS = [
  "curl",
  "ssh",
  "git push",
  "gh pr",
  "deploy",
  "send_email",
  "smtp",
  "ngrok",
  "post",
  "reply",
  "like",
  "follow",
  "charge",
  "payment"
];

const READ_ONLY_COMMAND_RE = /^(pwd|ls|find|rg|grep|sed|cat|head|tail|wc|git status|git diff|git show|git log|node --version|npm --version|npm view|which)\b/;
const MUTATING_COMMAND_RE = /\b(rm|mv|cp|mkdir|touch|chmod|chown|npm install|pnpm install|yarn install|bun install|git commit|git add|git checkout|git switch|git reset|git clean|python .*setup|apply_patch)\b/;

export function classifyRisk(input: {
  eventType: string;
  toolName?: string;
  payload?: JsonObject;
}): RiskClass {
  const type = input.eventType;
  const toolName = input.toolName?.toLowerCase();
  const payloadText = stableStringify(input.payload || {}).toLowerCase();

  if (type === "patch_apply_end") {
    return "local_workspace_mutation";
  }

  if (toolName && MUTATING_TOOLS.has(toolName)) {
    return isLikelyExternal(toolName, payloadText) ? "external_side_effect" : "local_workspace_mutation";
  }

  if (toolName && READ_ONLY_TOOLS.has(toolName)) {
    return "read_only";
  }

  if (toolName === "exec_command" || toolName === "bash" || toolName === "shell_command") {
    const cmd = extractCommand(input.payload, payloadText);
    if (cmd && EXTERNAL_HINTS.some((hint) => cmd.includes(hint))) {
      return "external_side_effect";
    }
    if (cmd && MUTATING_COMMAND_RE.test(cmd)) {
      return "local_workspace_mutation";
    }
    if (cmd && READ_ONLY_COMMAND_RE.test(cmd)) {
      return "read_only";
    }
    return "unknown";
  }

  if (type === "web_search_call" || type === "web_search_end") {
    return "read_only";
  }

  if (toolName && isLikelyExternal(toolName, payloadText)) {
    return "external_side_effect";
  }

  return "unknown";
}

function isLikelyExternal(toolName: string, payloadText: string): boolean {
  return EXTERNAL_HINTS.some((hint) => toolName.includes(hint) || payloadText.includes(hint));
}

function extractCommand(payload: JsonObject | undefined, payloadText: string): string | undefined {
  const structured = extractCommandFromPayload(payload);
  if (structured) {
    return structured.toLowerCase();
  }
  const match = payloadText.match(/"cmd"\s*:\s*"([^"]+)"/) || payloadText.match(/"command"\s*:\s*"([^"]+)"/);
  return match?.[1]?.replace(/\\"/g, "\"");
}

function extractCommandFromPayload(payload: JsonObject | undefined): string | undefined {
  if (!payload) {
    return undefined;
  }

  const direct = asString(payload.cmd) || asString(payload.command);
  if (direct) {
    return direct;
  }

  const args = payload.arguments;
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      if (isObject(parsed)) {
        return asString(parsed.cmd) || asString(parsed.command);
      }
    } catch {
      return undefined;
    }
  }

  if (isObject(args)) {
    return asString(args.cmd) || asString(args.command);
  }

  return undefined;
}
