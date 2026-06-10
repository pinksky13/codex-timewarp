import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { appendOverride } from "../src/overrides.ts";
import { buildRecoveryPrompt, buildRestartRecoveryPack } from "../src/recovery-planner.ts";
import { assessRisk } from "../src/risk-classifier.ts";
import { readSessionByPath } from "../src/session-reader.ts";
import { findTimelineEvent, normalizeTimeline } from "../src/timeline-normalizer.ts";

const fixturePath = new URL("./fixtures/sample-session.jsonl", import.meta.url).pathname;
const pluginRoot = new URL("../", import.meta.url).pathname;
const timewarpBin = new URL("../bin/timewarp.ts", import.meta.url).pathname;

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
  assert.match(call.riskReason, /read-only command matrix/);
  assert.equal(call.linkedEventId, "E004");
  assert.equal(result.linkedEventId, "E003");
  assert.match(result.riskReason, /inherits call risk from E003/);
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
  assert.match(result.recoveryPack, /E003 tool_call priority=95/);
  assert.match(result.recoveryPack, /turn=1 tool_call function_call tool=exec_command call_id=call_ls risk=read_only/);
  assert.match(result.recoveryPack, /All transcript events after E004 are diagnostic only/);
  assert.match(result.recoveryPack, /Invalidated range: E005\.\.E007/);
  assert.match(result.recoveryPack, /The working tree may still include file changes made after the selected boundary/);
  assert.match(result.recoveryPack, /Inspect current workspace state before edits/);
  assert.deepEqual(result.warnings, ["Start a clean Codex conversation before using this pack."]);
  assert.equal(result.invalidatedEventCount, 3);
});

test("restart recovery pack includes long user intent beyond timeline preview", async () => {
  const dir = await mkdtemp(join(tmpdir(), "timewarp-long-user-"));
  const path = join(dir, "rollout-test-019elonguser.jsonl");
  const longRequirement = `Build the recommender with these exact constraints: ${"preserve detailed requirement ".repeat(40)}final requirement token.`;
  await writeSession(path, {
    id: "019elonguser",
    cwd: dir,
    events: [
      userMessage(longRequirement, "2026-06-09T02:00:01.000Z"),
      functionCall("call_pwd", "pwd", "2026-06-09T02:00:02.000Z"),
      functionOutput("call_pwd", `${dir}\n`, "2026-06-09T02:00:03.000Z")
    ]
  });

  try {
    const timeline = normalizeTimeline(await readSessionByPath(path));
    const result = buildRestartRecoveryPack({
      timeline,
      boundary: {
        side: "after",
        eventId: "E004"
      }
    });

    assert.match(result.recoveryPack, /preserve detailed requirement preserve detailed requirement/);
    assert.match(result.recoveryPack, /final requirement token/);
    assert.doesNotMatch(result.recoveryPack, /Build the recommender with these exact constraints: .*?\.\.\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("restart recovery pack truncates long tool output per context item", async () => {
  const dir = await mkdtemp(join(tmpdir(), "timewarp-long-output-"));
  const path = join(dir, "rollout-test-019elongoutput.jsonl");
  await writeSession(path, {
    id: "019elongoutput",
    cwd: dir,
    events: [
      userMessage("Inspect the generated output.", "2026-06-09T02:10:01.000Z"),
      functionCall("call_cat", "cat giant.txt", "2026-06-09T02:10:02.000Z"),
      functionOutput("call_cat", `first chunk\n${"tool output body ".repeat(400)}last chunk`, "2026-06-09T02:10:03.000Z"),
      functionCall("call_pwd", "pwd", "2026-06-09T02:10:04.000Z"),
      functionOutput("call_pwd", `${dir}\n`, "2026-06-09T02:10:05.000Z")
    ]
  });

  try {
    const timeline = normalizeTimeline(await readSessionByPath(path));
    const result = buildRestartRecoveryPack({
      timeline,
      boundary: {
        side: "after",
        eventId: "E006"
      },
      maxContextItemChars: 180
    });

    assert.match(result.recoveryPack, /first chunk/);
    assert.match(result.recoveryPack, /\[truncated\]/);
    assert.doesNotMatch(result.recoveryPack, /last chunk/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("restart recovery pack trims low-priority context before selected boundary or replacement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "timewarp-trim-"));
  const path = join(dir, "rollout-test-019etrim.jsonl");
  await writeSession(path, {
    id: "019etrim",
    cwd: dir,
    events: [
      userMessage(`Important final user intent ${"keep me ".repeat(20)}`, "2026-06-09T02:20:01.000Z"),
      functionCall("call_old", "cat older.txt", "2026-06-09T02:20:02.000Z"),
      functionOutput("call_old", "older low priority output ".repeat(80), "2026-06-09T02:20:03.000Z"),
      functionCall("call_pwd", "pwd", "2026-06-09T02:20:04.000Z"),
      functionOutput("call_pwd", `${dir}\n`, "2026-06-09T02:20:05.000Z")
    ]
  });

  try {
    const timeline = normalizeTimeline(await readSessionByPath(path));
    const result = buildRestartRecoveryPack({
      timeline,
      boundary: {
        side: "after",
        eventId: "E006"
      },
      replacement: "Corrected result must stay.",
      maxChars: 1_200,
      maxContextItemChars: 600
    });

    assert.match(result.recoveryPack, /- Event: E006 function_call_output tool=exec_command call_id=call_pwd/);
    assert.match(result.recoveryPack, /Corrected result must stay\./);
    assert.match(result.recoveryPack, /Important final user intent/);
    assert.ok(result.omittedContextEventCount > 0);
    assert.match(result.recoveryPack, /earlier meaningful event\(s\) omitted/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
      cwd: pluginRoot,
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
  assert.equal(payload.replacement_source, "explicit");
  assert.match(payload.recovery_pack, /^TIMEWARP RECOVERY PACK/);
  assert.deepEqual(payload.warnings, ["Start a clean Codex conversation before using this pack."]);
});

test("inspect CLI recommends hard restart commands before soft prompt", () => {
  const result = spawnSync(process.execPath, ["./bin/timewarp.ts", "inspect", "E004", "--path", fixturePath], {
    cwd: pluginRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  const hardBefore = result.stdout.indexOf(`timewarp restart --before E004 --path ${fixturePath}`);
  const hardAfter = result.stdout.indexOf(`timewarp restart --after E004 --path ${fixturePath}`);
  const soft = result.stdout.indexOf(`timewarp prompt --before E004 --path ${fixturePath}`);
  assert.ok(hardBefore > -1);
  assert.ok(hardAfter > -1);
  assert.ok(soft > hardAfter);
  assert.doesNotMatch(result.stdout, /timewarp restart --before E004 --latest/);
  assert.match(result.stdout, /Hard restart with corrected result/);
  assert.match(result.stdout, /Risk note: read-only events may be acceptable/);
});

test("inspect CLI recommends session selector when inspecting by session id", async () => {
  const oldHome = process.env.CODEX_HOME;
  const home = await mkdtemp(join(tmpdir(), "timewarp-inspect-session-"));
  const sessionsRoot = join(home, "sessions", "2026", "06", "09");
  await mkdir(sessionsRoot, { recursive: true });
  await writeSession(join(sessionsRoot, "rollout-test-019einspectsession.jsonl"), {
    id: "019einspectsession",
    cwd: home,
    events: [
      userMessage("Inspect by session.", "2026-06-09T05:00:01.000Z"),
      functionCall("call_pwd", "pwd", "2026-06-09T05:00:02.000Z"),
      functionOutput("call_pwd", `${home}\n`, "2026-06-09T05:00:03.000Z")
    ]
  });

  try {
    const result = spawnSync(process.execPath, ["./bin/timewarp.ts", "inspect", "E004", "--session", "019einspectsession"], {
      cwd: pluginRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_HOME: home
      }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /timewarp restart --before E004 --session 019einspectsession/);
    assert.match(result.stdout, /timewarp restart --after E004 --session 019einspectsession/);
    assert.doesNotMatch(result.stdout, /timewarp restart --before E004 --latest/);
  } finally {
    restoreEnv("CODEX_HOME", oldHome);
    await rm(home, { recursive: true, force: true });
  }
});

test("inspect CLI preserves workspace selectors in recommended commands", async () => {
  const oldHome = process.env.CODEX_HOME;
  const home = await mkdtemp(join(tmpdir(), "timewarp-inspect-workspace-"));
  const workspace = join(home, "workspace");
  const sessionsRoot = join(home, "sessions", "2026", "06", "09");
  await mkdir(sessionsRoot, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeSession(join(sessionsRoot, "rollout-test-019einspectworkspace.jsonl"), {
    id: "019einspectworkspace",
    cwd: workspace,
    events: [
      userMessage("Inspect by workspace.", "2026-06-09T05:10:01.000Z"),
      functionCall("call_pwd", "pwd", "2026-06-09T05:10:02.000Z"),
      functionOutput("call_pwd", `${workspace}\n`, "2026-06-09T05:10:03.000Z")
    ]
  });

  try {
    const cwdResult = spawnSync(process.execPath, [timewarpBin, "inspect", "E004", "--latest", "--cwd", workspace], {
      cwd: pluginRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_HOME: home
      }
    });

    assert.equal(cwdResult.status, 0, cwdResult.stderr);
    assert.match(cwdResult.stdout, new RegExp(`timewarp restart --before E004 --latest --cwd ${escapeRegExp(workspace)}`));
    assert.match(cwdResult.stdout, new RegExp(`timewarp restart --after E004 --latest --cwd ${escapeRegExp(workspace)}`));
    assert.match(cwdResult.stdout, new RegExp(`timewarp prompt --before E004 --latest --cwd ${escapeRegExp(workspace)}`));
    assert.doesNotMatch(cwdResult.stdout, /timewarp restart --before E004 --latest\n/);

    const currentWorkspaceResult = spawnSync(process.execPath, [timewarpBin, "inspect", "E004", "--latest", "--current-workspace"], {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_HOME: home
      }
    });

    assert.equal(currentWorkspaceResult.status, 0, currentWorkspaceResult.stderr);
    assert.match(currentWorkspaceResult.stdout, /timewarp restart --before E004 --latest --current-workspace/);
    assert.match(currentWorkspaceResult.stdout, /timewarp restart --after E004 --latest --current-workspace/);
    assert.match(currentWorkspaceResult.stdout, /timewarp prompt --before E004 --latest --current-workspace/);
    assert.doesNotMatch(currentWorkspaceResult.stdout, /timewarp restart --before E004 --latest\n/);
  } finally {
    restoreEnv("CODEX_HOME", oldHome);
    await rm(home, { recursive: true, force: true });
  }
});

test("inspect JSON includes risk reason and override metadata", async () => {
  const oldHome = process.env.CODEX_HOME;
  const home = await mkdtemp(join(tmpdir(), "timewarp-inspect-json-"));
  process.env.CODEX_HOME = home;

  try {
    await appendOverride({
      session_id: "019etest-session",
      target_event_id: "E004",
      replacement: "Corrected output from override."
    });

    const result = spawnSync(process.execPath, ["./bin/timewarp.ts", "inspect", "E004", "--path", fixturePath, "--json"], {
      cwd: pluginRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_HOME: home
      }
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.event.eventId, "E004");
    assert.equal(payload.event.override.replacement, "Corrected output from override.");
    assert.equal(payload.override.replacement, "Corrected output from override.");
    assert.match(payload.event.riskReason, /inherits call risk from E003/);
  } finally {
    restoreEnv("CODEX_HOME", oldHome);
    await rm(home, { recursive: true, force: true });
  }
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
        cwd: pluginRoot,
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
      cwd: pluginRoot,
      encoding: "utf8",
      input: "Replacement from stdin."
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.recovery_pack, /Corrected tool result:\nReplacement from stdin\./);
});

test("restart CLI uses latest override unless explicit replacement is supplied", async () => {
  const oldHome = process.env.CODEX_HOME;
  const home = await mkdtemp(join(tmpdir(), "timewarp-override-"));
  process.env.CODEX_HOME = home;

  try {
    await appendOverride({
      session_id: "019etest-session",
      target_event_id: "E004",
      replacement: "older override"
    });
    await appendOverride({
      session_id: "019etest-session",
      target_event_id: "E004",
      replacement: "latest override"
    });

    const overrideResult = spawnSync(process.execPath, ["./bin/timewarp.ts", "restart", "--path", fixturePath, "--after", "E004", "--json"], {
      cwd: pluginRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_HOME: home
      }
    });

    assert.equal(overrideResult.status, 0, overrideResult.stderr);
    const overridePayload = JSON.parse(overrideResult.stdout);
    assert.equal(overridePayload.replacement_source, "override");
    assert.match(overridePayload.recovery_pack, /Corrected tool result:\nlatest override/);
    assert.doesNotMatch(overridePayload.recovery_pack, /older override/);

    const explicitResult = spawnSync(
      process.execPath,
      ["./bin/timewarp.ts", "restart", "--path", fixturePath, "--after", "E004", "--replacement", "explicit replacement", "--json"],
      {
        cwd: pluginRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          CODEX_HOME: home
        }
      }
    );

    assert.equal(explicitResult.status, 0, explicitResult.stderr);
    const explicitPayload = JSON.parse(explicitResult.stdout);
    assert.equal(explicitPayload.replacement_source, "explicit");
    assert.match(explicitPayload.recovery_pack, /Corrected tool result:\nexplicit replacement/);
    assert.doesNotMatch(explicitPayload.recovery_pack, /latest override/);
  } finally {
    restoreEnv("CODEX_HOME", oldHome);
    await rm(home, { recursive: true, force: true });
  }
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
        cwd: pluginRoot,
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

test("show --latest prefers current workspace session and exposes selection JSON", async () => {
  const oldHome = process.env.CODEX_HOME;
  const home = await mkdtemp(join(tmpdir(), "timewarp-latest-"));
  const otherWorkspace = join(home, "other-workspace");
  const currentWorkspace = join(home, "current-workspace");
  const sessionsRoot = join(home, "sessions", "2026", "06", "09");
  await mkdir(sessionsRoot, { recursive: true });
  await mkdir(otherWorkspace, { recursive: true });
  await mkdir(currentWorkspace, { recursive: true });
  await writeSession(join(sessionsRoot, "rollout-test-019eother.jsonl"), {
    id: "019eother",
    cwd: otherWorkspace,
    events: [userMessage("Other workspace latest.", "2026-06-09T03:00:01.000Z")]
  });
  await writeSession(join(sessionsRoot, "rollout-test-019ecurrent.jsonl"), {
    id: "019ecurrent",
    cwd: currentWorkspace,
    events: [userMessage("Current workspace older.", "2026-06-09T02:59:01.000Z")]
  });

  try {
    process.env.CODEX_HOME = home;
    const result = spawnSync(process.execPath, [timewarpBin, "show", "--latest", "--json"], {
      cwd: currentWorkspace,
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_HOME: home
      }
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.session.sessionId, "019ecurrent");
    assert.equal(payload.session.selection.mode, "workspace_match");
    assert.equal(payload.session.selection.matched_cwd, currentWorkspace);
  } finally {
    restoreEnv("CODEX_HOME", oldHome);
    await rm(home, { recursive: true, force: true });
  }
});

test("show --latest warns when falling back to global latest", async () => {
  const oldHome = process.env.CODEX_HOME;
  const home = await mkdtemp(join(tmpdir(), "timewarp-fallback-"));
  const sessionsRoot = join(home, "sessions", "2026", "06", "09");
  await mkdir(sessionsRoot, { recursive: true });
  await writeSession(join(sessionsRoot, "rollout-test-019efallback.jsonl"), {
    id: "019efallback",
    cwd: join(home, "different-workspace"),
    events: [userMessage("Different workspace.", "2026-06-09T04:00:01.000Z")]
  });

  try {
    process.env.CODEX_HOME = home;
    const unmatchedWorkspace = join(home, "unmatched-workspace");
    await mkdir(unmatchedWorkspace, { recursive: true });
    const result = spawnSync(process.execPath, [timewarpBin, "show", "--latest", "--json"], {
      cwd: unmatchedWorkspace,
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_HOME: home
      }
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.session.sessionId, "019efallback");
    assert.equal(payload.session.selection.mode, "global_fallback");
    assert.match(payload.session.selection.warning, /No latest session matched workspace/);
  } finally {
    restoreEnv("CODEX_HOME", oldHome);
    await rm(home, { recursive: true, force: true });
  }
});

test("risk classifier matrix covers read-only, local mutation, external side effect, and unknown", () => {
  assert.deepEqual(
    assessRisk({
      eventType: "function_call",
      toolName: "exec_command",
      payload: { arguments: "{\"cmd\":\"sed -n '1,20p' README.md\"}" }
    }).risk,
    "read_only"
  );
  assert.deepEqual(
    assessRisk({
      eventType: "function_call",
      toolName: "exec_command",
      payload: { arguments: "{\"cmd\":\"git add README.md\"}" }
    }).risk,
    "local_workspace_mutation"
  );
  assert.deepEqual(
    assessRisk({
      eventType: "function_call",
      toolName: "exec_command",
      payload: { arguments: "{\"cmd\":\"git push origin main\"}" }
    }).risk,
    "external_side_effect"
  );
  assert.deepEqual(
    assessRisk({
      eventType: "function_call",
      toolName: "exec_command",
      payload: { arguments: "{\"cmd\":\"curl https://example.com\"}" }
    }).risk,
    "unknown"
  );
  assert.match(
    assessRisk({
      eventType: "function_call",
      toolName: "exec_command",
      payload: { arguments: "{\"cmd\":\"curl https://example.com\"}" }
    }).reason,
    /network or external-read uncertainty/
  );
  assert.deepEqual(
    assessRisk({
      eventType: "function_call",
      toolName: "exec_command",
      payload: { arguments: "{\"cmd\":\"cat README.md|pbcopy\"}" }
    }).risk,
    "unknown"
  );
  for (const cmd of ["cat README.md > out.txt", "sed -n '1,20p' README.md > out.txt", "pwd >> out.txt"]) {
    const assessment = assessRisk({
      eventType: "function_call",
      toolName: "exec_command",
      payload: { arguments: JSON.stringify({ cmd }) }
    });
    assert.equal(assessment.risk, "unknown");
    assert.match(assessment.reason, /output redirection/);
  }
  assert.equal(
    assessRisk({
      eventType: "patch_apply_end",
      toolName: "apply_patch",
      payload: {}
    }).risk,
    "local_workspace_mutation"
  );
});

function restoreEnv(name: string, oldValue: string | undefined): void {
  if (oldValue === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = oldValue;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function writeSession(
  path: string,
  options: {
    id: string;
    cwd: string;
    events: Record<string, unknown>[];
  }
): Promise<void> {
  const rows = [
    {
      timestamp: "2026-06-09T00:00:00.000Z",
      type: "session_meta",
      payload: {
        id: options.id,
        timestamp: "2026-06-09T00:00:00.000Z",
        cwd: options.cwd,
        cli_version: "0.136.0"
      }
    },
    {
      timestamp: "2026-06-09T00:00:00.500Z",
      type: "event_msg",
      payload: {
        type: "task_started",
        turn_id: `turn_${options.id}`,
        started_at: 1780966800
      }
    },
    ...options.events
  ];
  await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function userMessage(text: string, timestamp: string): Record<string, unknown> {
  return {
    timestamp,
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text
        }
      ]
    }
  };
}

function functionCall(callId: string, cmd: string, timestamp: string): Record<string, unknown> {
  return {
    timestamp,
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      arguments: JSON.stringify({ cmd }),
      call_id: callId
    }
  };
}

function functionOutput(callId: string, output: string, timestamp: string): Record<string, unknown> {
  return {
    timestamp,
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: callId,
      output
    }
  };
}
