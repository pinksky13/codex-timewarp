import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendOverride } from "../src/overrides.ts";
import { buildRecoveryPrompt } from "../src/recovery-planner.ts";
import { readSessionByPath } from "../src/session-reader.ts";
import { findTimelineEvent, normalizeTimeline } from "../src/timeline-normalizer.ts";

const fixturePath = new URL("./fixtures/sample-session.jsonl", import.meta.url).pathname;

test("normalizes Codex JSONL into linked tool-call timeline events", async () => {
  const raw = await readSessionByPath(fixturePath);
  const timeline = normalizeTimeline(raw);

  assert.equal(timeline.session.sessionId, "019etest-session");
  assert.equal(timeline.turns.length, 1);

  const call = findTimelineEvent(timeline, "E003");
  const result = findTimelineEvent(timeline, "E004");
  const patch = findTimelineEvent(timeline, "E006");

  assert.equal(call.kind, "tool_call");
  assert.equal(call.toolName, "exec_command");
  assert.equal(call.risk, "read_only");
  assert.equal(call.linkedEventId, "E004");
  assert.equal(result.linkedEventId, "E003");
  assert.equal(patch.risk, "local_workspace_mutation");
  assert.equal(patch.linkedEventId, "E005");
});

test("builds transcript-only recovery prompt with later-event warning", async () => {
  const timeline = normalizeTimeline(await readSessionByPath(fixturePath));
  const prompt = buildRecoveryPrompt({
    timeline,
    boundary: {
      side: "before",
      eventId: "E005"
    },
    replacement: "Use README.md only."
  });

  assert.match(prompt, /Continue this Codex task from before timeline event E005/);
  assert.match(prompt, /transcript-only recovery/);
  assert.match(prompt, /Do not assume workspace files were restored/);
  assert.match(prompt, /Use README\.md only\./);
});

test("writes override records to plugin-owned Codex state", async () => {
  const oldHome = process.env.CODEX_HOME;
  const home = await mkdtemp(join(tmpdir(), "timewarp-test-"));
  process.env.CODEX_HOME = home;

  try {
    const record = await appendOverride({
      session_id: "session-a",
      target_event_id: "E005",
      replacement: "corrected output"
    });

    assert.equal(record.type, "timewarp_override");
    assert.equal(record.target_event_id, "E005");
    assert.equal(record.replacement, "corrected output");
  } finally {
    if (oldHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = oldHome;
    }
    await rm(home, { recursive: true, force: true });
  }
});
