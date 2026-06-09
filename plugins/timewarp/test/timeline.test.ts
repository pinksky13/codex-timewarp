import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { appendOverride } from "../src/overrides.ts";
import { buildRecoveryPrompt, buildRestartRecoveryPack } from "../src/recovery-planner.ts";
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

  assert.match(prompt, /SOFT TIMEWARP RECOVERY PROMPT/);
  assert.match(prompt, /later polluted context may still influence the model/);
  assert.match(prompt, /Continue this Codex task from before timeline event E005/);
  assert.match(prompt, /transcript-only recovery/);
  assert.match(prompt, /Do not assume workspace files were restored/);
  assert.match(prompt, /Use README\.md only\./);
});

test("builds hard restart recovery pack for a clean conversation", async () => {
  const timeline = normalizeTimeline(await readSessionByPath(fixturePath));
  const result = buildRestartRecoveryPack({
    timeline,
    boundary: {
      side: "after",
      eventId: "E004"
    },
    replacement: "Corrected README.md listing."
  });

  assert.match(result.recoveryPack, /^TIMEWARP RECOVERY PACK\n\nDo not paste this into the old Codex session/m);
  assert.match(result.recoveryPack, /\/new or \/clear first/);
  assert.match(result.recoveryPack, /- Session: 019etest-session/);
  assert.match(result.recoveryPack, /- Side: after/);
  assert.match(result.recoveryPack, /- Event: E004 function_call_output tool=exec_command call_id=call_ls/);
  assert.match(result.recoveryPack, /- Risk: read_only/);
  assert.match(result.recoveryPack, /Corrected tool result:\nCorrected README\.md listing\./);
  assert.match(result.recoveryPack, /Valid prior context:/);
  assert.match(result.recoveryPack, /E003 turn=1 tool_call function_call tool=exec_command call_id=call_ls/);
  assert.match(result.recoveryPack, /All transcript events after E004 are diagnostic only/);
  assert.match(result.recoveryPack, /Invalidated range: E005\.\.E007/);
  assert.match(result.recoveryPack, /The working tree may still include file changes made after the selected boundary/);
  assert.match(result.recoveryPack, /Inspect current workspace state before edits/);
  assert.deepEqual(result.warnings, ["Start a clean Codex conversation before using this pack."]);
  assert.equal(result.invalidatedEventCount, 3);
});

test("restart recovery pack invalidates the selected event for before boundaries", async () => {
  const timeline = normalizeTimeline(await readSessionByPath(fixturePath));
  const result = buildRestartRecoveryPack({
    timeline,
    boundary: {
      side: "before",
      eventId: "E005"
    }
  });

  assert.match(result.recoveryPack, /- Side: before/);
  assert.match(result.recoveryPack, /The selected event E005 and all later transcript events are diagnostic only/);
  assert.match(result.recoveryPack, /Invalidated range: E005\.\.E007/);
  assert.doesNotMatch(result.recoveryPack, /E005 turn=1 tool_call function_call tool=apply_patch/);
  assert.doesNotMatch(result.recoveryPack, /Linked event: E006 patch_apply_end/);
});

test("restart recovery pack truncates large replacement unless explicitly allowed", async () => {
  const timeline = normalizeTimeline(await readSessionByPath(fixturePath));
  const replacement = "x".repeat(4_050);
  const result = buildRestartRecoveryPack({
    timeline,
    boundary: {
      side: "after",
      eventId: "E004"
    },
    replacement
  });

  assert.match(result.recoveryPack, /\[truncated\]/);
  assert.match(result.warnings.join("\n"), /Corrected tool result was truncated to 4000 characters/);
});

test("restart CLI emits required JSON shape", () => {
  const result = spawnSync(
    process.execPath,
    ["./bin/timewarp.ts", "restart", "--path", fixturePath, "--after", "E004", "--replacement", "Corrected output", "--json"],
    {
      cwd: new URL("../", import.meta.url).pathname,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.mode, "restart");
  assert.equal(payload.session_id, "019etest-session");
  assert.deepEqual(payload.boundary, {
    side: "after",
    event_id: "E004"
  });
  assert.equal(payload.copied, false);
  assert.match(payload.recovery_pack, /^TIMEWARP RECOVERY PACK/);
  assert.deepEqual(payload.warnings, ["Start a clean Codex conversation before using this pack."]);
});

test("restart CLI accepts replacement text from a file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "timewarp-replacement-"));
  const replacementPath = join(dir, "replacement.txt");
  await writeFile(replacementPath, "Replacement from file.", "utf8");

  try {
    const result = spawnSync(
      process.execPath,
      ["./bin/timewarp.ts", "restart", "--path", fixturePath, "--after", "E004", "--replacement-file", replacementPath, "--json"],
      {
        cwd: new URL("../", import.meta.url).pathname,
        encoding: "utf8"
      }
    );

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.match(payload.recovery_pack, /Corrected tool result:\nReplacement from file\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("restart CLI accepts replacement text from stdin", () => {
  const result = spawnSync(
    process.execPath,
    ["./bin/timewarp.ts", "restart", "--path", fixturePath, "--after", "E004", "--stdin", "--json"],
    {
      cwd: new URL("../", import.meta.url).pathname,
      encoding: "utf8",
      input: "Replacement from stdin."
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.recovery_pack, /Corrected tool result:\nReplacement from stdin\./);
});

test("restart CLI reports successful best-effort clipboard copy", { skip: process.platform === "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "timewarp-clipboard-"));
  const command = process.platform === "darwin" ? "pbcopy" : "wl-copy";
  const commandPath = join(dir, command);
  await writeFile(commandPath, "#!/bin/sh\ncat >/dev/null\nexit 0\n", "utf8");
  await chmod(commandPath, 0o755);

  try {
    const result = spawnSync(
      process.execPath,
      ["./bin/timewarp.ts", "restart", "--path", fixturePath, "--after", "E004", "--copy", "--json"],
      {
        cwd: new URL("../", import.meta.url).pathname,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH || ""}`
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.copied, true);
    assert.deepEqual(payload.warnings, ["Start a clean Codex conversation before using this pack."]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
