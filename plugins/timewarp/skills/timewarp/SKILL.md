---
name: timewarp
description: Inspect Codex session timelines, locate bad tool calls, and generate clean-session Timewarp restart recovery packs.
---

# Codex Timewarp

Use this skill when the user asks for `/timewarp`, `timewarp`, tool-call recovery, bad tool call inspection, result override, rewind, clean continuation, or continuing a Codex session from a specific tool event.

## Commands

Run the local CLI from the plugin root:

```sh
node "${PLUGIN_ROOT:-plugins/timewarp}/bin/timewarp.ts" show --latest
node "${PLUGIN_ROOT:-plugins/timewarp}/bin/timewarp.ts" show --latest --tools-only
node "${PLUGIN_ROOT:-plugins/timewarp}/bin/timewarp.ts" show --latest --cwd "$(pwd)" --tools-only
node "${PLUGIN_ROOT:-plugins/timewarp}/bin/timewarp.ts" inspect E001 --latest
node "${PLUGIN_ROOT:-plugins/timewarp}/bin/timewarp.ts" restart --before E001 --latest
node "${PLUGIN_ROOT:-plugins/timewarp}/bin/timewarp.ts" restart --after E001 --replacement "corrected tool output" --latest --copy
node "${PLUGIN_ROOT:-plugins/timewarp}/bin/timewarp.ts" prompt --before E001 --latest
node "${PLUGIN_ROOT:-plugins/timewarp}/bin/timewarp.ts" override E002 --replacement "corrected tool output" --latest
```

When installed as a Codex plugin, `PLUGIN_ROOT` should be set by the plugin runtime. For local clone debugging, run commands from the repository root so `plugins/timewarp/` resolves correctly.

## Recovery Policy

- Execute Timewarp CLI commands directly when the user's intent is clear. Do not respond with only a command for the user to run.
- When the user says `timewarp show`, `show latest`, or asks to inspect the latest tool chain, run `show --latest --current-workspace --tools-only` unless they supplied more specific flags.
- When the user says `inspect E123`, run `inspect E123` with the same selector context they requested, defaulting to `--latest --current-workspace`.
- When the user says `restart before E123` or `restart after E123`, run the matching `restart` command immediately. Default to `--latest --current-workspace --copy` unless the user supplied `--path`, `--session`, `--cwd`, replacement text, or explicitly said not to copy.
- After running `restart`, return the generated recovery pack or a concise summary plus clipboard status. Do not merely tell the user how to run restart themselves.
- Prefer `show` and `inspect` before suggesting a recovery action.
- `--latest` prefers the current workspace and warns on global fallback. Use `--cwd <path>` when the desired workspace is not the current shell directory.
- Treat this MVP as transcript-only recovery.
- Do not claim workspace files were restored.
- Do not rerun mutating or external-side-effect tools automatically.
- Prefer `restart` over `prompt` when the user wants recovery, rewind, or a clean continuation.
- After generating a `restart` recovery pack, stop and tell the user to start a clean Codex conversation with `/new` or `/clear`, then paste the whole pack. Do not continue the original task in the old session.
- Use `prompt` only when the user explicitly accepts soft recovery in the current session.
- For a corrected tool result, use `restart --after <event-id> --replacement ...` for hard recovery.
- Use `override` when the user wants plugin-owned override state. `restart --after <event-id>` automatically uses the latest matching override only when no explicit `--replacement`, `--replacement-file`, or `--stdin` is supplied.
- Treat `unknown` risk reasons, including network reads such as `curl`, `git fetch`, and package metadata lookups, as requiring inspection before rerun.
- Hooks only write diagnostic payloads to `$CODEX_HOME/timewarp/hooks/last-hook.json`; they do not rewind sessions, create clean conversations, mutate transcripts, or restore workspace files.

## User-Facing Flow

1. Execute `show` to display the timeline with stable IDs.
2. Execute `inspect` for the suspect event.
3. Execute `restart` from the chosen boundary, copying the pack when clipboard support is available.
4. Tell the user to start `/new` or `/clear`, paste the generated pack there, and continue from the selected boundary.

The original Codex session JSONL files must remain unchanged.
