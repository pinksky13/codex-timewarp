import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function getCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.CODEX_HOME || join(homedir(), ".codex"));
}

export function getSessionRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(getCodexHome(env), "sessions");
}

export function getTimewarpStateRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(getCodexHome(env), "timewarp");
}
