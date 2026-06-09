---
name: timewarp
description: Inspect Codex session timelines, locate bad tool calls, and generate safe transcript-only recovery prompts.
---

# Codex Timewarp

Use this skill when the user asks for `/timewarp`, `timewarp`, tool-call recovery, bad tool call inspection, result override, or continuing a Codex session from a specific tool event.

## Commands

Run the local CLI from the plugin root:

```sh
node "${PLUGIN_ROOT:-plugins/timewarp}/bin/timewarp.ts" show --latest
node "${PLUGIN_ROOT:-plugins/timewarp}/bin/timewarp.ts" show --latest --tools-only
node "${PLUGIN_ROOT:-plugins/timewarp}/bin/timewarp.ts" inspect E001 --latest
node "${PLUGIN_ROOT:-plugins/timewarp}/bin/timewarp.ts" prompt --before E001 --latest
node "${PLUGIN_ROOT:-plugins/timewarp}/bin/timewarp.ts" override E002 --replacement "corrected tool output" --latest
```

When installed as a Codex plugin, `PLUGIN_ROOT` should be set by the plugin runtime. For local clone debugging, run commands from the repository root so `plugins/timewarp/` resolves correctly.

## Recovery Policy

- Prefer `show` and `inspect` before suggesting a recovery action.
- Treat this MVP as transcript-only recovery.
- Do not claim workspace files were restored.
- Do not rerun mutating or external-side-effect tools automatically.
- For a corrected tool result, use `override`, then show the generated continuation prompt.

## User-Facing Flow

1. Show the timeline with stable IDs.
2. Inspect the suspect event.
3. If the result is wrong, write an override.
4. Ask Codex to continue using the generated recovery prompt.

The original Codex session JSONL files must remain unchanged.
