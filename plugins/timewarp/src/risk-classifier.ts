import type { JsonObject, RiskAssessment, RiskClass } from "./types.ts";
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

const NETWORK_UNCERTAIN_HINTS = [
  "curl",
  "git fetch",
  "npm view",
  "npm pack",
  "brew info",
  "brew list",
  "gh pr view",
  "gh pr diff"
];

const EXTERNAL_SIDE_EFFECT_HINTS = [
  "ssh",
  "git push",
  "gh pr create",
  "gh pr merge",
  "gh pr close",
  "gh release create",
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

const READ_ONLY_COMMAND_RE =
  /^(pwd|ls|find|rg|grep|sed -n|sed --version|sed\b|cat|head|tail|wc|git status|git diff|git show|git log|node --version|npm --version|npm view|which)\b/;
const MUTATING_COMMAND_RE =
  /\b(rm|mv|cp|mkdir|touch|chmod|chown|sed -i|npm install|pnpm install|yarn install|bun install|brew install|uv sync|git commit|git add|git checkout|git switch|git reset|git clean|python .*setup|apply_patch)\b/;
const CHAINING_RE = /&&|\|\||;|\|/;
const WRITE_REDIRECTION_RE = /(?:^|[^<>])(?:&>|[0-9]?>|>>)/;
const HEREDOC_RE = /<<<?/;

export function classifyRisk(input: {
  eventType: string;
  toolName?: string;
  payload?: JsonObject;
}): RiskClass {
  return assessRisk(input).risk;
}

export function assessRisk(input: {
  eventType: string;
  toolName?: string;
  payload?: JsonObject;
}): RiskAssessment {
  const type = input.eventType;
  const toolName = input.toolName?.toLowerCase();
  const payloadText = stableStringify(input.payload || {}).toLowerCase();

  if (type === "patch_apply_end") {
    return {
      risk: "local_workspace_mutation",
      reason: "patch_apply_end records a local workspace patch."
    };
  }

  if (toolName && MUTATING_TOOLS.has(toolName)) {
    if (isLikelyExternalSideEffect(toolName, payloadText)) {
      return {
        risk: "external_side_effect",
        reason: `tool ${toolName} matched mutating external side-effect hints.`
      };
    }
    return {
      risk: "local_workspace_mutation",
      reason: `tool ${toolName} is a known local mutating tool.`
    };
  }

  if (toolName && READ_ONLY_TOOLS.has(toolName)) {
    return {
      risk: "read_only",
      reason: `tool ${toolName} is in the read-only tool allowlist.`
    };
  }

  if (toolName === "exec_command" || toolName === "bash" || toolName === "shell_command") {
    const cmd = extractCommand(input.payload, payloadText);
    if (!cmd) {
      return {
        risk: "unknown",
        reason: "shell command arguments could not be extracted."
      };
    }
    if (WRITE_REDIRECTION_RE.test(cmd)) {
      return {
        risk: "unknown",
        reason: "shell command contains output redirection; inspect the target before rerunning."
      };
    }
    if (HEREDOC_RE.test(cmd)) {
      return {
        risk: "unknown",
        reason: "shell command contains heredoc or herestring syntax; inspect the full command before rerunning."
      };
    }
    if (CHAINING_RE.test(cmd)) {
      return {
        risk: "unknown",
        reason: "shell command contains chaining or pipes; inspect the full command before rerunning."
      };
    }
    if (EXTERNAL_SIDE_EFFECT_HINTS.some((hint) => cmd.includes(hint))) {
      return {
        risk: "external_side_effect",
        reason: `shell command matched external side-effect hint: ${matchingHint(cmd, EXTERNAL_SIDE_EFFECT_HINTS)}.`
      };
    }
    if (NETWORK_UNCERTAIN_HINTS.some((hint) => cmd.includes(hint))) {
      return {
        risk: "unknown",
        reason: `shell command matched network or external-read uncertainty hint: ${matchingHint(cmd, NETWORK_UNCERTAIN_HINTS)}.`
      };
    }
    if (MUTATING_COMMAND_RE.test(cmd)) {
      return {
        risk: "local_workspace_mutation",
        reason: "shell command matched the local mutation command matrix."
      };
    }
    if (READ_ONLY_COMMAND_RE.test(cmd)) {
      return {
        risk: "read_only",
        reason: "shell command matched the read-only command matrix."
      };
    }
    return {
      risk: "unknown",
      reason: "shell command did not match the read-only, local mutation, or external side-effect matrices."
    };
  }

  if (type === "web_search_call" || type === "web_search_end") {
    return {
      risk: "read_only",
      reason: "web search events are read-only transcript observations."
    };
  }

  if (toolName && isLikelyExternalSideEffect(toolName, payloadText)) {
    return {
      risk: "external_side_effect",
      reason: `tool ${toolName} or its payload matched external side-effect hints.`
    };
  }

  return {
    risk: "unknown",
    reason: "event type and tool name are not covered by the risk matrix."
  };
}

function isLikelyExternalSideEffect(toolName: string, payloadText: string): boolean {
  return EXTERNAL_SIDE_EFFECT_HINTS.some((hint) => toolName.includes(hint) || payloadText.includes(hint));
}

function extractCommand(payload: JsonObject | undefined, payloadText: string): string | undefined {
  const structured = extractCommandFromPayload(payload);
  if (structured) {
    return structured.toLowerCase();
  }
  const match = payloadText.match(/"cmd"\s*:\s*"([^"]+)"/) || payloadText.match(/"command"\s*:\s*"([^"]+)"/);
  return match?.[1]?.replace(/\\"/g, "\"");
}

function matchingHint(value: string, hints: string[]): string {
  return hints.find((hint) => value.includes(hint)) || "unknown";
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
