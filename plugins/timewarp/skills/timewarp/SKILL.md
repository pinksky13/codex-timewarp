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
node "${PLUGIN_ROOT:-plugins/timewarp}/bin/timewarp.ts" inspect E001 --latest
node "${PLUGIN_ROOT:-plugins/timewarp}/bin/timewarp.ts" restart --before E001 --latest
node "${PLUGIN_ROOT:-plugins/timewarp}/bin/timewarp.ts" restart --after E001 --replacement "corrected tool output" --latest --copy
node "${PLUGIN_ROOT:-plugins/timewarp}/bin/timewarp.ts" prompt --before E001 --latest
node "${PLUGIN_ROOT:-plugins/timewarp}/bin/timewarp.ts" override E002 --replacement "corrected tool output" --latest
```

When installed as a Codex plugin, `PLUGIN_ROOT` should be set by the plugin runtime. For local clone debugging, run commands from the repository root so `plugins/timewarp/` resolves correctly.

## Recovery Policy

- Prefer `show` and `inspect` before suggesting a recovery action.
- Treat this MVP as transcript-only recovery.
- Do not claim workspace files were restored.
- Do not rerun mutating or external-side-effect tools automatically.
- Prefer `restart` over `prompt` when the user wants recovery, rewind, or a clean continuation.
- After generating a `restart` recovery pack, stop and tell the user to start a clean Codex conversation with `/new` or `/clear`, then paste the whole pack. Do not continue the original task in the old session.
- Use `prompt` only when the user explicitly accepts soft recovery in the current session.
- For a corrected tool result, use `restart --after <event-id> --replacement ...` for hard recovery. Use `override` only when the user specifically wants plugin-owned override state.

## User-Facing Flow

1. Show the timeline with stable IDs.
2. Inspect the suspect event.
3. Generate a `restart` recovery pack from the chosen boundary.
4. Tell the user to start `/new` or `/clear`, paste the pack there, and continue from the selected boundary.

The original Codex session JSONL files must remain unchanged.
