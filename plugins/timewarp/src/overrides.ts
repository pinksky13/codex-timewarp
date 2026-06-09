import { mkdir, appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getTimewarpStateRoot } from "./paths.ts";
import { isObject } from "./json.ts";
import type { OverrideRecord } from "./types.ts";

export async function appendOverride(record: Omit<OverrideRecord, "type" | "override_kind" | "author" | "created_at">): Promise<OverrideRecord> {
  const override: OverrideRecord = {
    type: "timewarp_override",
    override_kind: "tool_result",
    author: "user",
    created_at: new Date().toISOString(),
    ...record
  };
  const dir = join(getTimewarpStateRoot(), "overrides");
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, `${override.session_id}.jsonl`), `${JSON.stringify(override)}\n`);
  return override;
}

export async function readOverrides(sessionId: string): Promise<OverrideRecord[]> {
  const path = join(getTimewarpStateRoot(), "overrides", `${sessionId}.jsonl`);
  let body: string;
  try {
    body = await readFile(path, "utf8");
  } catch (error) {
    if (isObject(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return body
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OverrideRecord);
}
