# Codex Timewarp

[English](./README.md) | [Simplified Chinese](./README.zh-CN.md)

Recover Codex runs from the exact bad prompt, assistant message, tool call, or tool result instead of restarting the whole task.

`codex-timewarp` is a Codex plugin marketplace repository for the `timewarp` plugin, a TypeScript/Node MVP for inspecting Codex session transcripts and generating safe recovery prompts.

## What It Solves

Long agent runs often fail at one specific point:

- a prompt sent the run in the wrong direction
- the model chose the wrong tool
- a tool call used bad arguments
- a tool result was incomplete, stale, or misleading
- the model misread a tool result
- a later patch changed files you did not intend to change

Restarting the whole task wastes context and time. Timewarp lets you inspect the session timeline, locate the bad event, and generate a recovery prompt from that exact boundary.

## Features

- Parse Codex JSONL sessions under `$CODEX_HOME/sessions` or `~/.codex/sessions`.
- Normalize transcript events into stable IDs like `E001`.
- Group events by user/task turn.
- Link tool calls to tool results by `call_id`.
- Inspect prompts, messages, tool calls, tool results, and patch events.
- Classify side-effect risk: `read_only`, `local_workspace_mutation`, `external_side_effect`, or `unknown`.
- Generate transcript-only recovery prompts.
- Store manual tool-result overrides under `$CODEX_HOME/timewarp/overrides/`.

Timewarp intentionally does not rewrite original session files, restore workspace files, or rerun mutating tools automatically.

## Repository Layout

```text
.agents/plugins/marketplace.json
package.json
README.md
README.zh-CN.md
plugins/timewarp/
  .codex-plugin/plugin.json
  skills/timewarp/SKILL.md
  bin/timewarp.ts
  hooks/hooks.json
  hooks/timewarp-hook.ts
  src/
  test/
```

The repository root is the marketplace root. `plugins/timewarp/` is the plugin root.

## Install As A Codex Plugin

Install from GitHub with SSH. This is the safest option for private repositories or setups that already use GitHub SSH keys:

```sh
codex plugin marketplace add git@github.com:pinksky13/codex-timewarp.git --ref main
codex plugin add timewarp@codex-timewarp
```

Then restart Codex so plugin skills and hooks are reloaded.

If the repository is public and your environment can clone from GitHub over HTTPS, the shorthand form also works:

```sh
codex plugin marketplace add pinksky13/codex-timewarp --ref main
codex plugin add timewarp@codex-timewarp
```

To test installation without touching your real Codex config:

```sh
mkdir -p /tmp/timewarp-codex-home
CODEX_HOME=/tmp/timewarp-codex-home codex plugin marketplace add git@github.com:pinksky13/codex-timewarp.git --ref main
CODEX_HOME=/tmp/timewarp-codex-home codex plugin add timewarp@codex-timewarp
CODEX_HOME=/tmp/timewarp-codex-home codex plugin list --marketplace codex-timewarp
```

## Quick Start

Clone the repository, then run commands from the repository root:

```sh
git clone git@github.com:pinksky13/codex-timewarp.git
cd codex-timewarp
npm run check
npm run timewarp -- show --latest --tools-only --limit 20
```

`npm run check` runs syntax checks and tests. `npm run timewarp -- show ...` shows recent tool-related events from the latest Codex session.

## Common Commands

Show the latest timeline:

```sh
npm run timewarp -- show --latest --limit 30
```

Show only tool-related events:

```sh
npm run timewarp -- show --latest --tools-only --limit 30
```

Inspect one event:

```sh
npm run timewarp -- inspect E528 --latest
```

Generate a recovery prompt from before a bad event:

```sh
npm run timewarp -- prompt --before E528 --latest
```

Generate a recovery prompt from after an event:

```sh
npm run timewarp -- prompt --after E528 --latest
```

Write a manual tool-result override:

```sh
npm run timewarp -- override E529 --latest --replacement "Corrected tool output goes here."
```

Use JSON output for automation:

```sh
npm run timewarp -- show --latest --tools-only --json
npm run timewarp -- inspect E528 --latest --json
```

## Using Inside Codex

Native slash-command registration is not assumed in this MVP. The plugin exposes a `timewarp` skill and a CLI.

Inside Codex, ask:

```text
Use timewarp to show the latest timeline and focus on tool-related events.
```

Or ask Codex to run the CLI directly:

```text
Run: npm run timewarp -- show --latest --tools-only --limit 20
```

## Recommended Workflow

1. Run `show --latest --tools-only` to locate suspicious events.
2. Run `inspect <event-id>` on the suspected prompt, call, or result.
3. If the transcript should continue from a boundary, run `prompt --before <event-id>` or `prompt --after <event-id>`.
4. If a tool result was wrong or incomplete, run `override <event-id> --replacement ...`.
5. Use the generated recovery prompt in Codex.

## Best Practices

- Prefer `inspect` before recovery. Do not recover from an event ID based only on a short preview.
- Treat `unknown` and `local_workspace_mutation` risk labels conservatively.
- Use `prompt` for transcript-only recovery when the workspace may already contain later file changes.
- Use `override` when the tool result is stale, incomplete, or misleading, but the workspace does not need rollback.
- Keep replacement text short, factual, and specific.
- Do not use this MVP as proof that files were restored to an earlier state.
- Do not silently rerun mutating commands, deploys, pushes, posts, or email-sending commands.

## Safety Model

`prompt` and `fork` style recovery only generate text. They do not mutate Codex transcripts.

`override` writes synthetic override events to plugin-owned state:

```text
$CODEX_HOME/timewarp/overrides/<session_id>.jsonl
```

The original files under `~/.codex/sessions/**/rollout-*.jsonl` are never modified.

## MVP Limits

- No automatic workspace restore.
- No exact point-in-time file rollback.
- No automatic rerun of mutating tools.
- No native `/timewarp` slash command registration guarantee.
- No external side-effect rollback.

## License

MIT
